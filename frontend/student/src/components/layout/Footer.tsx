import React from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Phone, ShieldCheck, Clock, LifeBuoy } from '../ui/Icons'
import { MAIN_GATE, HELP_DESK_PHONE } from '../../utils/helpers'

export function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white pb-24 md:pb-12 pt-12 text-slate-600">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          {/* Brand Info */}
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-emerald-700 text-white font-black text-sm">
                D
              </span>
              <span className="text-lg font-black text-slate-900 tracking-tight">
                DETOMSITE
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The official campus food ordering & delivery platform. Fresh meals,
              live kitchens, and secure delivery.
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Verified Campus Kitchens</span>
            </div>
          </div>

          {/* Delivery Gate & Campus Rules */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-emerald-600" />
              Delivery Collection
            </h4>
            <div className="rounded-btn bg-slate-50 p-3 border border-slate-200 text-xs space-y-1.5">
              <p className="font-bold text-slate-900">{MAIN_GATE}</p>
              <p className="text-slate-500 leading-normal">
                All food parcels are collected at the main gate. Please arrive with your Token number.
              </p>
            </div>
          </div>

          {/* Operating Schedules */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-emerald-600" />
              Batch Schedules
            </h4>
            <ul className="space-y-2 text-xs text-slate-500">
              <li>
                <span className="font-semibold text-slate-800">Morning Batch:</span>
                <p>Orders until 12:30 PM (Delivery: 1:00 PM)</p>
              </li>
              <li>
                <span className="font-semibold text-slate-800">Evening Batch:</span>
                <p>Orders until 6:00 PM (Delivery: 7:30 PM)</p>
              </li>
            </ul>
          </div>

          {/* Help Desk */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
              <LifeBuoy className="h-3.5 w-3.5 text-emerald-600" />
              Support & Help
            </h4>
            <p className="text-xs text-slate-500 mb-3">
              Need assistance with an order or payment? Reach our campus help desk.
            </p>
            <a
              href={`tel:${HELP_DESK_PHONE}`}
              className="inline-flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              <span>Call +91 63826 03607</span>
            </a>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© 2026 DETOMSITE · Campus Food Platform · All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/shops" className="hover:text-slate-600">Explore</Link>
            <Link to="/orders" className="hover:text-slate-600">Orders</Link>
            <Link to="/profile" className="hover:text-slate-600">Profile</Link>
            <Link to="/profile?tab=support" className="hover:text-slate-600">Help Desk</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
