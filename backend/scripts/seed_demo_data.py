"""
Seed script to populate sample campus shops, products, and initial demo data.
Safe and idempotent: skips if shops already exist.
"""
from app.core.store import store as db
from app.core.security import hash_password


def seed_demo_system_data():
    existing_shops = db.list_shops()
    if existing_shops:
        print(f"System already has {len(existing_shops)} shops. Skipping seed.")
        return

    print("Seeding demo shops, products, and sample data...")

    # 1. Ensure Demo Shopkeeper exists
    vendor_user = db.get_user_by_username("vendor_demo")
    if not vendor_user:
        vendor_user, _ = db.register_user(
            username="vendor_demo",
            password_hash=hash_password("Password123!"),
            name="Demo Shopkeeper",
            role="shopkeeper",
            email="shopkeeper@demo.com",
            phone="+919876543212"
        )
    vendor_email = vendor_user.get("email", "shopkeeper@demo.com")

    # 2. Ensure Student User exists
    student_user = db.get_user_by_username("student_demo")
    if not student_user:
        student_user, _ = db.register_user(
            username="student_demo",
            password_hash=hash_password("Password123!"),
            name="Demo Student",
            role="student",
            email="student@demo.com",
            phone="+919876543210"
        )
    student_id = str(student_user["id"])

    # 3. Create Shop 1: Campus Central Canteen
    shop1 = db.create_shop({
        "name": "Campus Central Canteen",
        "category": "Meals & Snacks",
        "description": "Hot and fresh meals, daily specials, thalis, and quick snacks.",
        "shopkeeper_name": "Ramesh Kumar",
        "shopkeeper_email": vendor_email,
        "phone": "+919876543212",
        "opening_time": "08:00 AM",
        "closing_time": "10:00 PM",
        "upi_id": "canteen@upi",
    })
    shop1_id = shop1["id"]
    db.update_shop(shop1_id, {
        "status": "Open",
        "approval_status": "Approved",
        "present": True,
        "rating": 4.8,
    })

    # Products for Shop 1
    p1 = db.create_product({
        "shop_id": shop1_id,
        "name": "Special Veg Thali",
        "description": "2 Rotis, Paneer Sabzi, Dal Tadka, Jeera Rice, Salad & Sweet",
        "price": 90,
        "category": "Meals",
        "prep_time": 10,
        "available": True,
    })
    p2 = db.create_product({
        "shop_id": shop1_id,
        "name": "Paneer Butter Masala + Naan Combo",
        "description": "Rich cottage cheese gravy served with 2 freshly made butter naans.",
        "price": 120,
        "category": "Meals",
        "prep_time": 15,
        "available": True,
    })
    p3 = db.create_product({
        "shop_id": shop1_id,
        "name": "Crispy Aloo Samosa (2 pcs)",
        "description": "Golden crispy pastry stuffed with spiced potatoes and peas, served with mint chutney.",
        "price": 30,
        "category": "Snacks",
        "prep_time": 5,
        "available": True,
    })
    p4 = db.create_product({
        "shop_id": shop1_id,
        "name": "Kulhad Masala Chai",
        "description": "Authentic ginger and cardamom brewed tea in a traditional earthen cup.",
        "price": 15,
        "category": "Beverages",
        "prep_time": 5,
        "available": True,
    })
    p5 = db.create_product({
        "shop_id": shop1_id,
        "name": "Cold Coffee with Ice Cream",
        "description": "Thick blended cold coffee topped with vanilla scoop.",
        "price": 50,
        "category": "Beverages",
        "prep_time": 5,
        "available": True,
    })

    # 4. Create Shop 2: Night Owl Cafe
    shop2 = db.create_shop({
        "name": "Night Owl Cafe & Bakery",
        "category": "Bakery & Fast Food",
        "description": "Late night burgers, wraps, sandwiches, pastries, and shakes.",
        "shopkeeper_name": "Priya Sharma",
        "shopkeeper_email": "nightowl@campus.local",
        "phone": "+919876543213",
        "opening_time": "12:00 PM",
        "closing_time": "02:00 AM",
        "upi_id": "nightowl@upi",
    })
    shop2_id = shop2["id"]
    db.update_shop(shop2_id, {
        "status": "Open",
        "approval_status": "Approved",
        "present": True,
        "rating": 4.6,
    })

    # Products for Shop 2
    p6 = db.create_product({
        "shop_id": shop2_id,
        "name": "Cheese Grilled Sandwich",
        "description": "Three layered sandwich packed with melted mozzarella and fresh bell peppers.",
        "price": 60,
        "category": "Snacks",
        "prep_time": 8,
        "available": True,
    })
    p7 = db.create_product({
        "shop_id": shop2_id,
        "name": "Crispy Veg Burger + Fries",
        "description": "Herb potato patty burger with cheese and seasoned fries.",
        "price": 85,
        "category": "Snacks",
        "prep_time": 12,
        "available": True,
    })
    p8 = db.create_product({
        "shop_id": shop2_id,
        "name": "Warm Chocolate Walnut Brownie",
        "description": "Gooey chocolate brownie with toasted walnuts.",
        "price": 55,
        "category": "Desserts",
        "prep_time": 5,
        "available": True,
    })

    # 5. Create a sample initial order for student_demo
    order1 = db.create_order({
        "shop_id": shop1_id,
        "owner_user_id": student_id,
        "student_name": student_user.get("name", "Demo Student"),
        "student_phone": "+919876543210",
        "items": [
            {"product_id": p1["id"], "name": p1["name"], "price": p1["price"], "quantity": 1},
            {"product_id": p3["id"], "name": p3["name"], "price": p3["price"], "quantity": 1},
        ],
        "delivery_location": "Hostel 4, Room 204",
        "delivery_slot": "1:00 PM - 1:30 PM",
        "status": "Preparing",
    })

    print(f"✓ Created Shop 1: {shop1['name']} ({shop1_id}) with 5 products")
    print(f"✓ Created Shop 2: {shop2['name']} ({shop2_id}) with 3 products")
    if order1:
        print(f"✓ Created sample order #{order1.get('token')} for {student_user.get('name')}")
    print("✓ Demo system seeding complete!")


if __name__ == "__main__":
    seed_demo_system_data()
