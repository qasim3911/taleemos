import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSchoolContext, hasModulePermission } from '@/lib/auth/school-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/supabase/server';

const CreateTransportSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add_vehicle'),
    vehicle_number: z.string().trim().min(1, 'Registration number is required').max(50),
    vehicle_type: z.string().trim().min(1).max(60).default('Hiace Van'),
    capacity: z.coerce.number().int().min(1).max(200).default(15),
    driver_name: z.string().trim().min(1, 'Driver name is required').max(100),
    driver_mobile: z.string().trim().min(3, 'Driver mobile is required').max(30),
    driver_cnic: z.string().trim().max(30).optional().nullable(),
  }),
  z.object({
    action: z.literal('add_route'),
    route_name: z.string().trim().min(1, 'Route name is required').max(150),
    vehicle_id: z.string().uuid().optional().nullable().or(z.literal('')),
    stops: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    monthly_fee_pkr: z.coerce.number().min(0).max(1000000).default(0),
  }),
]);

export async function GET() {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'transport')) {
    return NextResponse.json({ error: 'Insufficient module permissions for Transport.' }, { status: 403 });
  }

  const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
  if (!db) {
    return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
  }

  const [{ data: vehicles, error: vehErr }, { data: routes, error: routeErr }] = await Promise.all([
    db
      .from('transport_vehicles')
      .select('*')
      .eq('school_id', context.school.id)
      .order('vehicle_number', { ascending: true }),
    db
      .from('transport_routes')
      .select('*')
      .eq('school_id', context.school.id)
      .order('route_name', { ascending: true }),
  ]);

  if (vehErr || routeErr) {
    return NextResponse.json(
      { error: vehErr?.message || routeErr?.message || 'Unable to load transport records.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    vehicles: vehicles ?? [],
    routes: routes ?? [],
  });
}

export async function POST(request: Request) {
  const authResult = await getSchoolContext();
  if (authResult.status !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized or unapproved school.' }, { status: 403 });
  }

  const { context } = authResult;
  if (!hasModulePermission(context.member, 'transport')) {
    return NextResponse.json({ error: 'Insufficient module permissions for Transport.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = CreateTransportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid transport payload.', issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = createSupabaseAdminClient() ?? (await createSupabaseServerClient());
    if (!db) {
      return NextResponse.json({ error: 'Database client unavailable.' }, { status: 500 });
    }

    if (parsed.data.action === 'add_vehicle') {
      const { data: vehicle, error } = await db
        .from('transport_vehicles')
        .insert({
          school_id: context.school.id,
          vehicle_number: parsed.data.vehicle_number,
          vehicle_type: parsed.data.vehicle_type,
          capacity: parsed.data.capacity,
          driver_name: parsed.data.driver_name,
          driver_mobile: parsed.data.driver_mobile,
          driver_cnic: parsed.data.driver_cnic || null,
          monthly_maintenance_pkr: 0,
          status: 'active',
        })
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, vehicle });
    }

    const vehicleId = parsed.data.vehicle_id ? parsed.data.vehicle_id : null;
    if (vehicleId) {
      const { data: ownedVehicle, error: vehicleCheckErr } = await db
        .from('transport_vehicles')
        .select('id')
        .eq('id', vehicleId)
        .eq('school_id', context.school.id)
        .maybeSingle();

      if (vehicleCheckErr || !ownedVehicle) {
        return NextResponse.json(
          { error: 'Selected vehicle does not belong to this school.' },
          { status: 404 }
        );
      }
    }

    const { data: route, error: routeErr } = await db
      .from('transport_routes')
      .insert({
        school_id: context.school.id,
        vehicle_id: vehicleId,
        route_name: parsed.data.route_name,
        stops: parsed.data.stops,
        monthly_fee_pkr: parsed.data.monthly_fee_pkr,
      })
      .select('*')
      .single();

    if (routeErr) {
      return NextResponse.json({ error: routeErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, route });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save transport record.' },
      { status: 500 }
    );
  }
}
