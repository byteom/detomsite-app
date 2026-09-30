import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { LocalPaymentSettings } from '../types/localApi'
import { getCartByShop } from '../utils/cart'
import { getCheckoutProfile, getLocalSession, rememberCheckout } from '../utils/session'
import { PhoneInput, isValidMobile } from '../components/PhoneInput'

/* Delivery is a single fixed drop point: the VIT-AP main gate (enforced
   server-side too), so the checkout shows it as a read-only field. */
const DEFAULT_LOC = 'VIT-AP Main Gate'
function isVitAp(v: string) { return /vit[\s-]*ap/i.test(v || '') && /main[\s-]*gate/i.test(v || '') }

export function PaymentPage() {
  const navigate = useNavigate()
  const session = getLocalSession()
  const [ps, setPs] = useState<LocalPaymentSettings | null>(null)
  /* Payment is no longer chosen at checkout. The student places the order and
     pays by QR on the NEXT page, so the method is DERIVED: UPI whenever the
     admin has a UPI ID configured, Cash on Delivery only when they do not.
     There is no toggle to get wrong and no QR on the checkout screen. */
  const [slot, setSlot] = useState<'Afternoon' | 'Night'>(
    () => (getCheckoutProfile().slot === 'Night' ? 'Night' : 'Afternoon'),
  )
  /* Phone + location are restored from the remembered checkout profile so a
     returning student does not retype their number after logging out and back
     in — the "we get out and come back" case. The session wins when it has a
     value, and the profile fills the gap. */
  const [remembered] = useState(() => getCheckoutProfile())
  // One fixed drop point, so the location is constant rather than user-editable.
  const loc = DEFAULT_LOC
  const [phone, setPhone] = useState(() => session?.phone || remembered.phone || '')
  const [error, setError] = useState('')
  const groups = getCartByShop()
  const total = groups.reduce((sum, g) => sum + g.subtotal, 0)
  const manualReady = Boolean(ps?.manual_enabled && ps.upi_id)
  /* Derived, not chosen: UPI when it is configured, COD as the fallback. Until
     the settings load we assume UPI so a slow response never silently pushes a
     student onto cash. */
  const method: 'manual' | 'cod' = manualReady ? 'manual' : 'cod'

  useEffect(() => {
    api.get<LocalPaymentSettings>('/local/payment-settings')
      .then(r => setPs(r.data)).catch(() => setError('Cannot load payment settings'))
  }, [])

  /* GPS "use my location" removed: delivery is VIT-AP campus only, and a GPS
     reverse-geocode (city/state/country) would push off-campus text into the
     order. The VIT-AP select below is the only delivery input. */

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!groups.length) { setError('Cart empty'); return }
    if (!isValidMobile(phone)) { setError('Please enter a valid 10-digit mobile number'); return }
    if (!isVitAp(loc)) { setError('Delivery is VIT-AP main gate only.'); return }

    /* Remember the number + gate BEFORE moving on: if the payment page fails to
       load, the student still must not have to retype their number on the retry
       (this was the "get out and come back" complaint). */
    rememberCheckout({ phone: phone.replace(/\s/g, ''), location: loc, slot })

    if (method === 'manual' && !manualReady) { setError('This shop has not set up UPI payments yet — please try again later.'); return }

    /* Checkout only COLLECTS the details — it places no order. The order is
       created on the payment page, where the student sees the QR and the exact
       amount first and then commits with "Place Order". Nothing reaches the
       vendors until that final tap, so an abandoned checkout leaves no order. */
    navigate('/pay')
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-primary-dark">Checkout</h1>
          <p className="mt-1 text-sm font-medium text-gray-500">
            {groups.length === 0 ? 'Review your order' : `${groups.length} shop${groups.length > 1 ? 's' : ''} · one payment`}
          </p>
        </div>
        {groups.length === 0 ? (
          <div className="rounded-btn bg-white p-8 text-center shadow-card">
            <p className="mb-4 text-lg font-semibold text-gray-600">Cart is empty</p>
            <Link to="/shops" className="inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-gold-sm">Browse →</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="rounded-btn bg-white p-5 shadow-card">
              <h2 className="mb-4 text-lg font-bold text-primary-dark">Delivery Details · VIT-AP only</h2>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="mb-1 block text-sm font-bold text-gray-500">Delivery location (VIT-AP main gate)</label>
                  {/* One fixed drop point: a read-only field, not a picker. A
                      free-text "room / block" box here could only produce a
                      value the server now rejects, so it is gone. */}
                  <div className="flex w-full items-center justify-between rounded-btn border-2 border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900">
                    <span className="font-semibold">{DEFAULT_LOC}</span>
                    <span className="text-[11px] font-bold text-gray-500">Collect at the gate</span>
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-primary">📍 Every order is collected at the VIT-AP main gate.</p>
                </div>
                <PhoneInput value={phone} onChange={setPhone} placeholder="98765 43210" required />
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-bold text-primary-dark">Delivery slot</label>
                <select value={slot} onChange={e => setSlot(e.target.value as 'Afternoon' | 'Night')}
                  className="rounded-btn border-2 border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-primary">
                  <option value="Afternoon">Afternoon slot · deliver 1:00 – 1:30 PM</option>
                  <option value="Night">Night slot · deliver 7:30 – 8:00 PM</option>
                </select>
              </div>

              {error && <p className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm font-medium text-red-600">{error}</p>}
            </div>

            <div className="h-fit rounded-btn bg-white p-5 shadow-gold">
              <h2 className="mb-4 text-lg font-bold text-primary-dark">Summary</h2>
              <div className="space-y-2 text-sm">
                {groups.map(g => (
                  <div key={g.shop_id} className="flex justify-between">
                    <span className="text-gray-500">{g.shop_name}</span>
                    <span className="font-semibold text-primary">₹{g.subtotal}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-3 text-lg font-bold text-primary-dark">
                  <span>Total</span><span>₹{total}</span>
                </div>
                <p className="pt-1 text-xs text-gray-400">No delivery fee, no taxes, no COD fee. Each shop's flat ₹10 per order is on them, never you.</p>
              </div>
              <button type="submit" className="mt-5 w-full rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white shadow-gold transition-all hover:bg-primary-dark">
                Proceed to Pay →
              </button>
              <p className="mt-3 text-center text-[11px] font-medium text-gray-400">
                Next page shows the QR and the amount. Your order is placed only when you tap Place Order.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}