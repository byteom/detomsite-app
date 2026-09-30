"""
Regression guard for the phone-gate account takeover (CRITICAL).

``POST /api/v1/local/auth/phone`` used to return a valid access token to anyone
who posted a phone number. For a number that already had an account that token
was the VICTIM'S OWN — so knowing a classmate's number (campus numbers are often
sequential or simply visible) was equivalent to logging in as them, exposing
their orders, delivery address and payment state.

Verified live before the fix:

    Victim onboarded: username=stu_9700000042
    ATTACKER: POST /local/auth/phone with only the number -> HTTP 200
      !! ACCOUNT TAKEOVER -> same user id as the victim
      !! Reads victim's order + payment: status=Pending Payment amount=220

The account is still created without friction the first time (the generated
password is returned ONCE so the student can save it), but signing back in now
requires that password. These tests pin all of that down.
"""
import pytest

from app.core.security import verify_password
from app.core.store import store as db


async def _onboard(client, phone, name="Priya Victim", password=None, ip="10.6.6.1"):
    body = {"phone": phone, "name": name}
    if password is not None:
        body["password"] = password
    return await client.post("/api/v1/local/auth/phone", json=body,
                             headers={"x-forwarded-for": ip})


async def test_new_number_still_works_and_returns_a_password(client):
    """First-time onboarding must stay frictionless — and hand back a password."""
    res = await _onboard(client, "+919700000101")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["access_token"]
    # Shown exactly once, so the student can sign back in later.
    assert body["generated_password"], "a new account must return its password once"
    # ...and that password really is the account's credential.
    user = db.get_user_by_username(f"stu_{body['user']['username'].split('_')[-1]}")
    assert user and verify_password(body["generated_password"], user["password_hash"])


async def test_phone_alone_cannot_take_over_an_existing_account(client):
    """THE regression: knowing the number must NOT yield a session."""
    first = await _onboard(client, "+919700000102")
    assert first.status_code == 200
    victim_token = first.json()["access_token"]

    # The attacker knows ONLY the phone number, from a different IP.
    attack = await _onboard(client, "+919700000102", name="Priya Victim", ip="203.0.113.77")
    assert attack.status_code == 401, "phone number alone must not authenticate"
    assert "access_token" not in attack.json()

    # ...and the victim's own session is untouched.
    me = await client.get("/api/v1/local/auth/me",
                          headers={"Authorization": f"Bearer {victim_token}"})
    assert me.status_code == 200


async def test_wrong_password_is_refused_and_does_not_leak_registration(client):
    """A wrong password and a missing password must be indistinguishable."""
    await _onboard(client, "+919700000103")

    missing = await _onboard(client, "+919700000103", ip="203.0.113.78")
    wrong = await _onboard(client, "+919700000103", password="not-the-password",
                           ip="203.0.113.79")
    assert missing.status_code == wrong.status_code == 401
    # Identical wording: the response must not reveal that the number exists.
    assert missing.json()["detail"] == wrong.json()["detail"]


async def test_correct_password_signs_back_in(client):
    """The returning-student path still works with the saved password."""
    created = (await _onboard(client, "+919700000104")).json()
    pw = created["generated_password"]
    original_id = created["user"]["id"]

    again = await _onboard(client, "+919700000104", name="Priya Victim",
                           password=pw, ip="203.0.113.80")
    assert again.status_code == 200, again.text
    body = again.json()
    assert body["access_token"]
    assert body["user"]["id"] == original_id
    # The password is NEVER returned again — otherwise this endpoint would be
    # a password oracle.
    assert body["generated_password"] is None


async def test_password_guessing_is_throttled_per_number(client):
    """Rotating source IPs must not let an attacker brute-force the password.

    The per-IP bucket alone is useless here (the attacker owns many addresses),
    so there is a separate per-NUMBER limit that no IP can evade.
    """
    await _onboard(client, "+919700000105")
    codes = []
    for i in range(14):
        r = await _onboard(client, "+919700000105", password=f"guess-{i}",
                           ip=f"198.51.100.{i + 1}")
        codes.append(r.status_code)
    assert 429 in codes, f"per-number throttle never fired: {codes}"
    # The legitimate student is throttled too, which is the correct trade-off:
    # the limit is per number, so it cannot be lifted by changing address.
