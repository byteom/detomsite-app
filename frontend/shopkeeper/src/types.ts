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
}

export interface OrderPayment {
  utr_number?: string | null
  screenshot_name?: string | null
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
  payment?: OrderPayment | null
  _day?: string
}

export interface ShopStats {
  today_orders?: number
  today_revenue?: number
  month_revenue?: number
  platform_fee_due?: number
  admin_upi_id?: string
  admin_receiver_name?: string
  share_paid_today?: boolean
  share_paid_month?: boolean
  [key: string]: any
}

export interface HistoryData {
  orders: Order[]
  daily: { date: string; count: number; revenue: number }[]
  revenue: number
  count: number
}
