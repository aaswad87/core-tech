import type { Metadata } from "next";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAdmin, STAFF_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { listCommissions } from "@/lib/finance/queries";
import { COMMISSION_STATUS, usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Commissions" };

const ORDER = ["forecast", "earned", "payable", "paid", "clawed_back", "cancelled"];

export default async function CommissionsPage() {
  const user = await requireRole(STAFF_ROLES, "/recruiter/commissions");
  const admin = isAdmin(user.roles);
  const rows = await listCommissions();
  // Admins see everyone's in the table, but the totals on this page are always their own.
  const mine = rows.filter((r) => r.recruiter_id === user.id);
  const totals = ORDER.map((status) => ({
    status,
    amount: mine.filter((r) => r.status === status).reduce((s, r) => s + Number(status === "paid" ? (r.paid_amount ?? r.amount) : r.amount), 0),
  })).filter((t) => t.status !== "cancelled");

  return (
    <Container className="grid gap-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Commissions</h1>
        <p className="mt-2 text-muted-foreground">
          {admin ? "Everyone's commissions. Manage them on each placement in Finance." : "Your commissions on placements. Ask an administrator if something looks wrong."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {totals.map((t) => (
          <Card key={t.status}>
            <CardHeader>
              <CardDescription>Your {COMMISSION_STATUS[t.status].label.toLowerCase()}</CardDescription>
              <CardTitle className="text-xl tabular-nums">{usd(t.amount)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{COMMISSION_STATUS[t.status].help}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{admin ? "All commissions" : "Your commissions"}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commissions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    {admin && <th className="py-2 pr-4 font-medium">Recruiter</th>}
                    <th className="py-2 pr-4 font-medium">Placement</th>
                    <th className="py-2 pr-4 font-medium">Start</th>
                    <th className="py-2 pr-4 text-right font-medium">Fee</th>
                    <th className="py-2 pr-4 font-medium">Split × rate</th>
                    <th className="py-2 pr-4 text-right font-medium">Commission</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {admin && <td className="py-2 pr-4">{r.recruiter_name}</td>}
                      <td className="py-2 pr-4">
                        {admin ? (
                          <Link href={`/recruiter/finance/placements/${r.placement_id}`} className="text-brand hover:underline">
                            {r.candidate_name}
                          </Link>
                        ) : (
                          r.candidate_name
                        )}
                        <div className="text-xs text-muted-foreground">{r.company_name}</div>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{r.start_date}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(r.fee_amount)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {Number(r.split_percent)}% × {Number(r.rate_percent)}%
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{usd(r.paid_on ? r.paid_amount : r.amount)}</td>
                      <td className="py-2">
                        <Badge variant={r.status === "paid" || r.status === "payable" ? "secondary" : "outline"} title={COMMISSION_STATUS[r.status]?.help}>
                          {COMMISSION_STATUS[r.status]?.label ?? r.status}
                        </Badge>
                        {r.paid_on && <div className="text-xs text-muted-foreground">{r.paid_on}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
