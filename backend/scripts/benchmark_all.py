"""
Complete benchmark of all backend API endpoints.
Measures latency (min, max, avg), payload size, status code, and identifies slow endpoints.
Usage:
    python backend/scripts/benchmark_all.py
"""
import urllib.request
import json
import time
import os
import sys

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)
os.chdir(backend_dir)

from app.core.security import create_access_token

BASE_URL = "http://localhost:8000"


def run_benchmark():
    print("=" * 80)
    print("COMPLETE BACKEND API PERFORMANCE BENCHMARK & AUDIT")
    print("=" * 80)

    # 1. Create auth tokens
    admin_token = create_access_token({"sub": "1", "username": "12", "role": "admin", "name": "Administrator"})
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    student_token = create_access_token({"sub": "2", "username": "student_demo", "role": "student", "name": "Demo Student"})
    student_headers = {"Authorization": f"Bearer {student_token}"}

    vendor_token = create_access_token({"sub": "4", "username": "vendor_demo", "role": "shopkeeper", "name": "Demo Shopkeeper"})
    vendor_headers = {"Authorization": f"Bearer {vendor_token}"}

    endpoints = [
        # --- Public Endpoints ---
        ("Public", "Health Check", "GET", "/health", None, {}),
        ("Public", "Campus Status", "GET", "/api/v1/local/status", None, {}),
        ("Public", "Delivery Batch Info", "GET", "/api/v1/local/batch", None, {}),
        ("Public", "Student Notice", "GET", "/api/v1/local/student-notice", None, {}),
        ("Public", "List Shops", "GET", "/api/v1/local/shops?public_only=true", None, {}),
        ("Public", "Shop Detail (s130)", "GET", "/api/v1/local/shops/s130", None, {}),
        ("Public", "Shop Products (s130)", "GET", "/api/v1/local/products?shop_id=s130&limit=500", None, {}),
        ("Public", "Menu Summary", "GET", "/api/v1/local/menu-summary?match=biryani,rice", None, {}),
        ("Public", "Checkout Data", "GET", "/api/v1/local/checkout-data", None, {}),
        ("Public", "Announcements", "GET", "/api/v1/local/announcements", None, {}),
        
        # --- Student Portal Endpoints ---
        ("Student", "My Orders", "GET", "/api/v1/local/orders", None, student_headers),
        ("Student", "Notifications", "GET", "/api/v1/local/notifications?role=student", None, student_headers),
        ("Student", "User Profile (/users/profile)", "GET", "/api/v1/users/profile", None, student_headers),
        ("Student", "Support Tickets", "GET", "/api/v1/local/tickets", None, student_headers),
        
        # --- Vendor Portal Endpoints ---
        ("Vendor", "Vendor Dashboard", "GET", "/api/v1/vendor/dashboard", None, vendor_headers),
        ("Vendor", "Vendor Products", "GET", "/api/v1/vendor/products", None, vendor_headers),
        ("Vendor", "Vendor Orders", "GET", "/api/v1/vendor/orders", None, vendor_headers),
        ("Vendor", "Vendor History", "GET", "/api/v1/vendor/history", None, vendor_headers),

        # --- Admin Portal Endpoints ---
        ("Admin", "Admin Dashboard", "GET", "/api/v1/admin/dashboard", None, admin_headers),
        ("Admin", "Admin Vendors Directory", "GET", "/api/v1/admin/vendors", None, admin_headers),
        ("Admin", "Admin Users Directory", "GET", "/api/v1/admin/users", None, admin_headers),
        ("Admin", "Admin User 360 (/users/1)", "GET", "/api/v1/admin/users/1", None, admin_headers),
        ("Admin", "Admin User 360 (/users/2)", "GET", "/api/v1/admin/users/2", None, admin_headers),
        ("Admin", "Admin Orders Directory", "GET", "/api/v1/admin/orders", None, admin_headers),
        ("Admin", "Admin Payments Directory", "GET", "/api/v1/admin/payments", None, admin_headers),
        ("Admin", "Admin Feedback List", "GET", "/api/v1/admin/feedback", None, admin_headers),
        ("Admin", "Admin Reviews List", "GET", "/api/v1/admin/reviews", None, admin_headers),
        ("Admin", "Admin Notifications", "GET", "/api/v1/admin/notifications", None, admin_headers),
    ]

    results = []

    print(f"{'Category':<9} | {'Endpoint Name':<28} | {'Status':<6} | {'Size':>7} | {'Avg (ms)':>8} | {'Min (ms)':>8} | {'Max (ms)':>8}")
    print("-" * 88)

    for category, name, method, path, body, headers in endpoints:
        url = f"{BASE_URL}{path}"
        data_bytes = json.dumps(body).encode() if body else None
        h = dict(headers)
        if body:
            h["Content-Type"] = "application/json"
        
        req = urllib.request.Request(url, data=data_bytes, headers=h, method=method)
        times = []
        status = None
        size = 0
        
        # 5 samples per endpoint to capture cold vs warm behavior
        for _ in range(5):
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req) as resp:
                    status = resp.status
                    raw = resp.read()
                    size = len(raw)
                    times.append((time.perf_counter() - t0) * 1000)
            except urllib.error.HTTPError as e:
                status = e.code
                raw = e.read()
                size = len(raw)
                times.append((time.perf_counter() - t0) * 1000)
            except Exception as e:
                times.append(-1)
                status = "ERR"

        valid_times = [t for t in times if t > 0]
        avg_t = sum(valid_times) / len(valid_times) if valid_times else 0
        min_t = min(valid_times) if valid_times else 0
        max_t = max(valid_times) if valid_times else 0

        flag = " ⚠️ SLOW" if avg_t > 100 else (" ❌ ERR" if str(status).startswith(('4', '5')) else "")
        print(f"{category:<9} | {name:<28} | {str(status):<6} | {size:>6}B | {avg_t:>8.1f} | {min_t:>8.1f} | {max_t:>8.1f}{flag}")
        results.append({
            "category": category,
            "name": name,
            "path": path,
            "status": status,
            "size": size,
            "avg_ms": avg_t,
            "min_ms": min_t,
            "max_ms": max_t,
        })

    print("-" * 88)
    slow_endpoints = [r for r in results if r["avg_ms"] > 50]
    print(f"\nAudit complete: {len(results)} endpoints benchmarked. {len(slow_endpoints)} endpoints > 50ms average.")
    return results


if __name__ == "__main__":
    run_benchmark()
