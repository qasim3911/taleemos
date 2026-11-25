'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useSchool } from '@/components/dashboard/school-context-provider';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface InventoryRow {
  id: string;
  item_name: string;
  category: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  supplier_name: string | null;
}

export default function InventoryPage() {
  const { school } = useSchool();
  const { toast } = useToast();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [form, setForm] = useState({ item_name: '', category: 'Stationery', quantity: '10', unit: 'pcs', unit_cost: '0', supplier_name: '', supplier_phone: '' });

  const loadData = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { data } = await supabase.from('inventory_items').select('*').eq('school_id', school.id).order('item_name');
    setRows(data ?? []);
    setLoading(false);
  }, [school.id]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { data: item, error } = await supabase
      .from('inventory_items')
      .insert({
        school_id: school.id,
        item_name: form.item_name,
        category: form.category,
        quantity: Number(form.quantity),
        unit: form.unit,
        unit_cost: Number(form.unit_cost),
        supplier_name: form.supplier_name || null,
        supplier_phone: form.supplier_phone || null,
      })
      .select('id')
      .single();

    if (error || !item) {
      toast({ title: 'Error saving item', description: error?.message, variant: 'error' });
      return;
    }

    await supabase.from('inventory_transactions').insert({
      school_id: school.id,
      item_id: item.id,
      tx_type: 'Purchase',
      quantity: Number(form.quantity),
      notes: `Initial stock from ${form.supplier_name || 'supplier'}`,
    });

    toast({ title: 'Inventory item added', variant: 'success' });
    setOpenAdd(false);
    loadData();
  };

  const adjustStock = async (item: InventoryRow, delta: number) => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const nextQty = Math.max(0, item.quantity + delta);
    await supabase
      .from('inventory_items')
      .update({ quantity: nextQty })
      .eq('id', item.id)
      .eq('school_id', school.id);
    await supabase.from('inventory_transactions').insert({
      school_id: school.id,
      item_id: item.id,
      tx_type: delta > 0 ? 'Purchase' : 'Issue',
      quantity: Math.abs(delta),
    });
    toast({ title: 'Stock updated', variant: 'success' });
    loadData();
  };

  const columns: TableColumn<InventoryRow>[] = [
    { key: 'name', header: 'Item / Asset', render: (r) => <span className="font-semibold">{r.item_name}</span>, exportValue: (r) => r.item_name },
    { key: 'cat', header: 'Category', render: (r) => r.category, exportValue: (r) => r.category },
    { key: 'qty', header: 'In Stock', align: 'right', render: (r) => <span className="font-mono-tabular font-semibold">{r.quantity} {r.unit}</span>, exportValue: (r) => r.quantity },
    { key: 'cost', header: 'Unit Cost (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.unit_cost).toLocaleString()}</span>, exportValue: (r) => Number(r.unit_cost) },
    { key: 'sup', header: 'Supplier', render: (r) => r.supplier_name || '—' },
    {
      key: 'act',
      header: 'Stock Action',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={() => adjustStock(r, 1)} className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px]">
            +1 Purchase
          </button>
          <button type="button" onClick={() => adjustStock(r, -1)} className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px]">
            -1 Issue
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="Inventory & Assets Management"
        subtitle="Track school assets, stationery, lab equipment, suppliers, purchases, and issue transactions."
        rows={rows}
        columns={columns}
        loading={loading}
        getRowKey={(r) => r.id}
        getSearchText={(r) => `${r.item_name} ${r.category} ${r.supplier_name || ''}`}
        exportFileName="school-inventory"
        primaryAction={
          <button type="button" onClick={() => setOpenAdd(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
            <Plus className="h-3.5 w-3.5" />
            Add Stock Item
          </button>
        }
      />

      <ModalDialog open={openAdd} onClose={() => setOpenAdd(false)} title="Add Inventory Item">
        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Item Name *</label>
              <input required value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="Assets">Assets</option>
                <option value="Stationery">Stationery</option>
                <option value="Equipment">Equipment</option>
                <option value="Lab">Lab</option>
                <option value="Furniture">Furniture</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Quantity</label>
              <input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Unit Cost (PKR)</label>
              <input type="number" min="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Supplier Name</label>
              <input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Supplier Phone</label>
              <input value={form.supplier_phone} onChange={(e) => setForm({ ...form, supplier_phone: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Save Item</button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
