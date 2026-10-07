export interface Shop {
  id: string
  name: string
  category: string
  description: string
  rating: number
  opening_time: string
  closing_time: string
  present: number | boolean
  status: string
  approval_status: string
  shopkeeper_email: string
  shopkeeper_name: string
  phone: string
  upi_id: string
  upi_enabled: number | boolean
  cod_enabled: number | boolean
  orders_today: number
  revenue_today: number
  current_token: number
  image_url?: string
}

export interface Product {
  id: string
  shop_id: string
  name: string
  description: string
  price: number
  pending_price: number | null
  category: string
  inventory: number
  prep_time: number
  available: number | boolean
  is_combo?: number | boolean
  combo_items?: string
  image_url?: string
  is_veg?: number | boolean
}

export interface Order {
  id: string
  token: number
  student_name: string
  student_phone: string
  shop_id: string
  shop_name: string
  items: string
  total: number
  delivery_location: string
  delivery_slot: string
  status: string
  payment_method?: string
  created_at: string
}

export interface Payment {
  id: string
  order_id: string
  amount: number
  method: string
  status: string
  utr_number: string | null
  created_at: string
}

export interface CartItem {
  product_id: string
  shop_id: string
  shop_name: string
  name: string
  price: number
  category: string
  quantity: number
  is_combo?: boolean
  combo_items?: string
}

export interface Notification {
  id: string
  title: string
  message: string
  order_id: string | null
  status: string | null
  is_read: number
  created_at: string
}

export interface PaymentSettings {
  manual_enabled: boolean
  upi_id: string
  receiver_name: string
  instructions: string
}

export type PaymentProofStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_PROOF_SUBMITTED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'

export interface PaymentProofState {
  proof_status: PaymentProofStatus
  utr_saved: boolean
  payment_submitted_at: string
  payment_verified_at: string
  payment_rejection_reason: string
}

/* Manual UPI proof submission (UTR + screenshot, admin-verified). Sent as
 * multipart/form-data to POST /local/payments/proof — never as JSON. */
export const PAYMENT_PROOF_MAX_MB = 5
export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface StudentNotice {
  enabled: boolean
  text: string
}

export interface UserProfile {
  id?: number | string
  name?: string
  username?: string
  email?: string
  phone?: string
  role?: string
}

export interface DeliveryBatch {
  batch_type: string
  next_token: number
  date_key: string
  accepted_until: string
  delivery_window: string
}
