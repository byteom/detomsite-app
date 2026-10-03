import React from 'react'
import {
  Store,
  Home,
  Package,
  Clock,
  ShoppingCart,
  Star,
  User,
  LifeBuoy,
  Bell,
  Search,
  AlertCircle,
  MapPin,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  CreditCard,
  Banknote,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Plus,
  Minus,
  Trash2,
  Phone,
  Lock,
  ArrowRight,
  Flame,
  Filter,
  CheckCircle2,
  XCircle,
  Sparkles,
  LogOut,
  Settings,
  ShieldCheck,
  Send,
  ExternalLink,
  Info,
  Calendar,
  Layers,
  Heart,
  HelpCircle,
  ShoppingBag,
  RotateCcw,
} from 'lucide-react'

export {
  Store,
  Home,
  Package,
  Clock,
  ShoppingCart,
  Star,
  User,
  LifeBuoy,
  Bell,
  Search,
  AlertCircle,
  MapPin,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  CreditCard,
  Banknote,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Plus,
  Minus,
  Trash2,
  Phone,
  Lock,
  ArrowRight,
  Flame,
  Filter,
  CheckCircle2,
  XCircle,
  Sparkles,
  LogOut,
  Settings,
  ShieldCheck,
  Send,
  ExternalLink,
  Info,
  Calendar,
  Layers,
  Heart,
  HelpCircle,
  ShoppingBag,
  RotateCcw,
}

/* ─── Specialized Food Delivery Symbols ─── */

/** Veg Symbol: Green circle inside green square border */
export function VegIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center border-2 border-emerald-600 rounded-sm p-[1.5px] bg-white ${className}`}
      title="Pure Vegetarian"
    >
      <span className="h-full w-full rounded-full bg-emerald-600" />
    </span>
  )
}

/** Non-Veg Symbol: Red/Brown triangle inside red square border */
export function NonVegIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center border-2 border-red-600 rounded-sm p-[1.5px] bg-white ${className}`}
      title="Non-Vegetarian"
    >
      <span
        className="h-0 w-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[6px] border-b-red-600"
      />
    </span>
  )
}

/** Campus Token Badge */
export function TokenBadge({ token, className = '' }: { token: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-black px-2.5 py-1 rounded-pill bg-emerald-100/80 text-emerald-900 border border-emerald-300 text-xs shadow-sm ${className}`}
    >
      <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Token</span>
      <span className="font-extrabold text-emerald-900">#{token}</span>
    </span>
  )
}
