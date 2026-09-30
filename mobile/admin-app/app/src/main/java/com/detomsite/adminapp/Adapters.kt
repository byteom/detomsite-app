package com.detomsite.adminapp

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.detomsite.adminapp.databinding.ItemOrderBinding
import com.detomsite.adminapp.databinding.ItemPendingOrderBinding

/**
 * The Approvals queue: one card per order waiting for the admin, each with its
 * own **Confirm** and *Not now* buttons.
 *
 * Rows are removed optimistically on a successful confirm so the list never
 * sits there offering a button for something already done.
 */
class PendingOrderAdapter(
    private val onConfirm: (PendingOrder) -> Unit,
    private val onDismiss: (PendingOrder) -> Unit,
) : RecyclerView.Adapter<PendingOrderAdapter.VH>() {

    private val rows = mutableListOf<PendingOrder>()

    fun submit(list: List<PendingOrder>) {
        rows.clear()
        rows.addAll(list)
        notifyDataSetChanged()
    }

    fun remove(orderId: String) {
        val index = rows.indexOfFirst { it.orderId == orderId }
        if (index >= 0) {
            rows.removeAt(index)
            notifyItemRemoved(index)
        }
    }

    fun count(): Int = rows.size

    class VH(val binding: ItemPendingOrderBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemPendingOrderBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount(): Int = rows.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val row = rows[position]
        val b = holder.binding
        b.tvToken.text = "#${row.token}"
        b.tvShop.text = row.shopName.ifBlank { "Shop" }
        b.tvStudent.text = row.studentName.ifBlank { "A student" }
        b.tvItems.text = row.items.ifBlank { "—" }
        b.tvAmount.text = "₹${row.total}"
        b.tvMethod.text = if (row.paymentMethod.equals("COD", true)) "Cash on Delivery" else "UPI"
        b.tvStatus.text = row.status
        b.tvWhere.text = listOfNotNull(
            row.deliveryLocation.takeIf { it.isNotBlank() },
            row.createdAt.take(16).takeIf { it.isNotBlank() && it != "null" },
        ).joinToString(" · ")

        // Disable both buttons for the duration of the tap so a double press can
        // never fire two confirmations. The server is idempotent too; this just
        // makes it visible in the UI.
        fun setBusy(busy: Boolean) {
            b.btnConfirm.isEnabled = !busy
            b.btnDismiss.isEnabled = !busy
            b.btnConfirm.text = if (busy) "Confirming…" else "Confirm order"
        }

        b.btnConfirm.setOnClickListener {
            setBusy(true)
            onConfirm(row)
        }
        b.btnDismiss.setOnClickListener {
            setBusy(true)
            onDismiss(row)
        }
    }
}

/**
 * The Orders tab: a compact, scrollable list of the newest orders. Orders that
 * can still be confirmed get a Confirm button inline, so the admin never has to
 * hunt through the Approvals tab for the one order they are looking at.
 */
class OrderRowAdapter(
    private val onConfirm: (OrderRow) -> Unit,
) : RecyclerView.Adapter<OrderRowAdapter.VH>() {

    private val rows = mutableListOf<OrderRow>()

    /** Mirrors the backend's CONFIRMABLE_ORDER_STATUSES guard. */
    private fun isConfirmable(status: String) = status in setOf(
        "Pending Payment", "Pending Acceptance", "Pending", "Placed", "Accepted",
    )

    fun submit(list: List<OrderRow>) {
        rows.clear()
        rows.addAll(list)
        notifyDataSetChanged()
    }

    class VH(val binding: ItemOrderBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemOrderBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount(): Int = rows.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val row = rows[position]
        val b = holder.binding
        b.tvTitle.text = "#${row.token} · ${row.shopName.ifBlank { "Shop" }}"
        b.tvSubtitle.text = "${row.studentName.ifBlank { "A student" }} · ${row.items.ifBlank { "—" }}"
        b.tvAmount.text = "₹${row.total}"
        b.tvStatus.text = row.status

        val canConfirm = isConfirmable(row.status)
        b.btnConfirm.visibility = if (canConfirm) android.view.View.VISIBLE else android.view.View.GONE
        b.btnConfirm.setOnClickListener {
            b.btnConfirm.isEnabled = false
            b.btnConfirm.text = "…"
            onConfirm(row)
        }
    }
}
