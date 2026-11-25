'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { DataTable, type TableColumn } from '@/components/dashboard/data-table';
import { ModalDialog } from '@/components/dashboard/modal-dialog';
import { useToast } from '@/components/providers/toast-provider';
import { Plus } from 'lucide-react';

interface VehicleRow {
  id: string;
  vehicle_number: string;
  vehicle_type: string;
  capacity: number;
  driver_name: string;
  driver_mobile: string;
  status: string;
}

interface RouteRow {
  id: string;
  vehicle_id: string | null;
  route_name: string;
  monthly_fee_pkr: number;
}

const INITIAL_VEHICLE_FORM = {
  vehicle_number: '',
  vehicle_type: 'Hiace Van',
  capacity: '15',
  driver_name: '',
  driver_mobile: '',
  driver_cnic: '',
};

const INITIAL_ROUTE_FORM = {
  vehicle_id: '',
  route_name: '',
  stops_csv: '',
  monthly_fee_pkr: '3500',
};

export default function TransportPage() {
  const { toast } = useToast();
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openVeh, setOpenVeh] = useState(false);
  const [openRoute, setOpenRoute] = useState(false);

  const [vForm, setVForm] = useState(INITIAL_VEHICLE_FORM);
  const [rForm, setRForm] = useState(INITIAL_ROUTE_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/transport', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Error loading transport', description: data.error || 'Unable to load transport records.', variant: 'error' });
        return;
      }
      setVehicles(data.vehicles ?? []);
      setRoutes(data.routes ?? []);
    } catch {
      toast({ title: 'Error loading transport', description: 'Network error while loading transport.', variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/transport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_vehicle',
          vehicle_number: vForm.vehicle_number,
          vehicle_type: vForm.vehicle_type,
          capacity: Number(vForm.capacity) || 15,
          driver_name: vForm.driver_name,
          driver_mobile: vForm.driver_mobile,
          driver_cnic: vForm.driver_cnic || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Error saving vehicle', description: data.error || 'Unable to save vehicle.', variant: 'error' });
        return;
      }
      toast({ title: 'Vehicle added', variant: 'success' });
      setVForm(INITIAL_VEHICLE_FORM);
      setOpenVeh(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleAddRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const stops = rForm.stops_csv.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch('/api/transport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_route',
          vehicle_id: rForm.vehicle_id || null,
          route_name: rForm.route_name,
          stops,
          monthly_fee_pkr: Number(rForm.monthly_fee_pkr) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: 'Error saving route', description: data.error || 'Unable to save route.', variant: 'error' });
        return;
      }
      toast({ title: 'Transport route created', variant: 'success' });
      setRForm(INITIAL_ROUTE_FORM);
      setOpenRoute(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const vColumns: TableColumn<VehicleRow>[] = [
    { key: 'vno', header: 'Vehicle No', render: (r) => <span className="font-mono-tabular font-semibold">{r.vehicle_number}</span>, exportValue: (r) => r.vehicle_number },
    { key: 'type', header: 'Type', render: (r) => r.vehicle_type, exportValue: (r) => r.vehicle_type },
    { key: 'cap', header: 'Capacity', align: 'right', render: (r) => <span className="font-mono-tabular">{r.capacity}</span> },
    { key: 'drv', header: 'Driver', render: (r) => `${r.driver_name} (${r.driver_mobile})`, exportValue: (r) => r.driver_name },
    { key: 'status', header: 'Status', render: (r) => r.status },
  ];

  const rColumns: TableColumn<RouteRow>[] = [
    { key: 'name', header: 'Route Name', render: (r) => <span className="font-semibold">{r.route_name}</span>, exportValue: (r) => r.route_name },
    { key: 'fee', header: 'Monthly Fee (PKR)', align: 'right', render: (r) => <span className="font-mono-tabular">{Number(r.monthly_fee_pkr).toLocaleString()}</span>, exportValue: (r) => Number(r.monthly_fee_pkr) },
  ];

  return (
    <div className="space-y-6">
      <DataTable
        title="School Transport Vehicles & Drivers"
        rows={vehicles}
        columns={vColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        exportFileName="transport-vehicles"
        primaryAction={
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpenVeh(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3.5 py-1.5 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Vehicle
            </button>
            <button type="button" onClick={() => { setRForm({ ...rForm, vehicle_id: vehicles[0]?.id || '' }); setOpenRoute(true); }} className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold">
              Add Route
            </button>
          </div>
        }
      />

      <DataTable
        title="Transport Routes & Monthly Fees"
        rows={routes}
        columns={rColumns}
        loading={loading}
        getRowKey={(r) => r.id}
        exportFileName="transport-routes"
      />

      <ModalDialog open={openVeh} onClose={() => setOpenVeh(false)} title="Add Vehicle & Driver">
        <form onSubmit={handleAddVehicle} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium">Registration No *</label>
              <input required value={vForm.vehicle_number} onChange={(e) => setVForm({ ...vForm, vehicle_number: e.target.value })} placeholder="LEB-2024" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Vehicle Type</label>
              <input value={vForm.vehicle_type} onChange={(e) => setVForm({ ...vForm, vehicle_type: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Driver Name *</label>
              <input required value={vForm.driver_name} onChange={(e) => setVForm({ ...vForm, driver_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium">Driver Mobile *</label>
              <input required value={vForm.driver_mobile} onChange={(e) => setVForm({ ...vForm, driver_mobile: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenVeh(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Vehicle'}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog open={openRoute} onClose={() => setOpenRoute(false)} title="Create Transport Route">
        <form onSubmit={handleAddRoute} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium">Route Name *</label>
            <input required value={rForm.route_name} onChange={(e) => setRForm({ ...rForm, route_name: e.target.value })} placeholder="Model Town → Gulberg → Campus" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          {vehicles.length > 0 && (
            <div>
              <label className="block font-medium">Assigned Vehicle</label>
              <select value={rForm.vehicle_id} onChange={(e) => setRForm({ ...rForm, vehicle_id: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicle_number} — {v.driver_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block font-medium">Stops (comma separated)</label>
            <input value={rForm.stops_csv} onChange={(e) => setRForm({ ...rForm, stops_csv: e.target.value })} placeholder="Link Road, Barkat Market, Kalma Chowk" className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block font-medium">Monthly Transport Fee (PKR)</label>
            <input type="number" min={0} value={rForm.monthly_fee_pkr} onChange={(e) => setRForm({ ...rForm, monthly_fee_pkr: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpenRoute(false)} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Route'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
