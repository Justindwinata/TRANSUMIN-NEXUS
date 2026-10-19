'use client';

import { useEffect, useState } from 'react';
import { AdminAccountProvisioning } from '../auth-ui';
import { opsApi } from '../../../lib/ops-api';
import type { OperatorPrincipal } from '../../../lib/ops';

export default function Page() {
  const [principal, setPrincipal] = useState<OperatorPrincipal | null>(null);
  useEffect(() => {
    opsApi
      .me()
      .then(setPrincipal)
      .catch(() => setPrincipal(null));
  }, []);
  if (!principal)
    return (
      <main className="ops-auth-state" role="status">
        Checking admin session…
      </main>
    );
  return <AdminAccountProvisioning principal={principal} />;
}
