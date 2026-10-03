from app.core.store import store, init_store
from app.core.security import hash_password

def main():
    init_store()

    users_to_seed = [
        {
            "username": "student_demo",
            "password": "Password123!",
            "name": "Demo Student",
            "role": "student",
            "email": "student@demo.com",
            "phone": "9876543210"
        },
        {
            "username": "admin_demo",
            "password": "Password123!",
            "name": "Demo Admin",
            "role": "admin",
            "email": "admin@demo.com",
            "phone": "9876543211"
        },
        {
            "username": "vendor_demo",
            "password": "Password123!",
            "name": "Demo Shopkeeper",
            "role": "shopkeeper",
            "email": "shopkeeper@demo.com",
            "phone": "9876543212"
        },
    ]

    for u in users_to_seed:
        uname = u["username"]
        pwd = u["password"]
        role = u["role"]
        existing = store.get_user_by_username(uname)
        if existing:
            print(f"User {uname} already exists (role={existing.get('role')})")
        else:
            pw_hash = hash_password(pwd)
            user, err = store.register_user(uname, pw_hash, u["name"], role, u["email"], u["phone"])
            if user:
                print(f"Created {role}: username='{uname}', password='{pwd}', email='{u['email']}'")
            else:
                print(f"Failed to create {uname}: {err}")

if __name__ == "__main__":
    main()
