import { NextResponse } from 'next/server';

export function GET() {
  const networkSnapshotId = process.env.PASSENGER_NETWORK_SNAPSHOT_ID;
  if (!networkSnapshotId || !/^[0-9a-f-]{36}$/i.test(networkSnapshotId)) {
    return NextResponse.json(
      {
        error: {
          code: 'DATASET_NOT_READY',
          message: 'Passenger routing snapshot is not configured.',
        },
      },
      { status: 503 },
    );
  }
  return NextResponse.json({
    data: { network_snapshot_id: networkSnapshotId },
  });
}
