import sys
import os

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.store import store, init_store
from app.core.security import hash_password


def main():
    print("=" * 60)
    print("SEEDING DEMO ROLES (1 Student, 1 Admin, 1 Shopkeeper)")
    print("=" * 60)
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
            # Ensure password and status are valid
            store.update_user_password(existing["id"], hash_password(pwd))
            if hasattr(store, "set_user_status"):
                store.set_user_status(existing["id"], "active")
            print(f"[+] User {uname} already existed -> password reset to '{pwd}' (role={existing.get('role')})")
        else:
            pw_hash = hash_password(pwd)
            user, err = store.register_user(uname, pw_hash, u["name"], role, u["email"], u["phone"])
            if user:
                print(f"[+] Created {role.upper()}: username='{uname}', password='{pwd}', email='{u['email']}'")
            else:
                print(f"[!] Failed to create {uname}: {err}")

    # Ensure demo shopkeeper has an approved, open shop to manage in vendor portal
    existing_shop = store.get_shop_by_shopkeeper_email("shopkeeper@demo.com")
    if not existing_shop:
        new_shop = store.create_shop({
            "name": "Demo Campus Cafe",
            "category": "Cafe & Snacks",
            "description": "Official demo cafe for testing vendor orders & live tokens",
            "opening_time": "08:00 AM",
            "closing_time": "10:00 PM",
            "shopkeeper_name": "Demo Shopkeeper",
            "phone": "9876543212",
            "upi_id": "demovendor@upi",
            "shopkeeper_email": "shopkeeper@demo.com",
            "upi_enabled": True,
            "cod_enabled": True,
        })
        store.update_shop(new_shop["id"], {
            "approval_status": "Approved",
            "status": "Open",
            "present": True
        })
        print(f"[+] Created active demo shop: '{new_shop.get('name')}' (id={new_shop.get('id')}) for shopkeeper@demo.com")

        # Seed sample items
        store.create_product({
            "shop_id": new_shop["id"],
            "name": "Veg Cheese Grilled Sandwich",
            "category": "Snacks",
            "price": 80,
            "description": "Crispy grilled sandwich with veggies and melted cheese",
            "available": True,
            "prep_time": 10
        })
        store.create_product({
            "shop_id": new_shop["id"],
            "name": "Cold Coffee Frappe",
            "category": "Beverages",
            "price": 60,
            "description": "Chilled chocolate coffee blend with cream",
            "available": True,
            "prep_time": 5
        })
        print("[+] Added 2 sample dishes to Demo Campus Cafe")
    else:
        # Make sure it's approved and open
        store.update_shop(existing_shop["id"], {
            "approval_status": "Approved",
            "status": "Open",
            "present": True
        })
        print(f"[+] Demo shop already exists: '{existing_shop.get('name')}' (id={existing_shop.get('id')}) - verified Open & Approved")

    print("\n" + "=" * 60)
    print("DEMO CREDENTIALS SUMMARY:")
    print("=" * 60)
    print("1. STUDENT PORTAL (http://localhost:5173)")
    print("   Username: student_demo")
    print("   Password: Password123!")
    print("   Email:    student@demo.com\n")
    print("2. ADMIN PORTAL (http://localhost:5174)")
    print("   Username: admin_demo")
    print("   Password: Password123!")
    print("   Email:    admin@demo.com\n")
    print("3. SHOPKEEPER / VENDOR PORTAL (http://localhost:5175)")
    print("   Username: vendor_demo")
    print("   Password: Password123!")
    print("   Email:    shopkeeper@demo.com")
    print("=" * 60)


if __name__ == "__main__":
    main()
