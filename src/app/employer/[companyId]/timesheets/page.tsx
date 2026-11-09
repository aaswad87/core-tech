import type { Metadata } from "next";

import { TimesheetReview } from "@/components/employer/forms";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listClientTimesheets } from "@/lib/contracts/queries";
import { usd } from "@/lib/finance/validation";

export const metadata: Metadata = { title: "Timesheets" };

const STATUS: Record<string, string> = { submitted: "Needs your approval", approved: "Approved", rejected: "Sent back" };

// Membership is checked by the layout; company_timesheets() checks it again and returns only billing data.
export default async function EmployerTimesheetsPage({ params }: PageProps<"/employer/[companyId]/timesheets">) {
  const { companyId } = await params;
  const rows = await listClientTimesheets(companyId);
  const pending = rows.filter((r) => r.status === "submitted");
  const done = rows.filter((r) => r.status !== "submitted");

  return (
    <Container className="grid max-w-4xl gap-6 py-8">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contractor timesheets. They appear here when CoreTech has contractors working for you.</p>
      ) : (
        [
          { title: `Waiting for your approval (${pending.length})`, list: pending, description: "Check the hours, then approve or send back with a note. Approved weeks are invoiced." },
          { title: "History", list: done, description: undefined },
        ]
          .filter((g) => g.list.length > 0)
          .map((g) => (
            <Card key={g.title}>
              <CardHeader>
                <CardTitle className="text-lg">{g.title}</CardTitle>
                {g.description && <CardDescription>{g.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {g.list.map((t) => {
                    const label = `${t.worker_name}, week of ${t.week_start}`;
                    return (
                      <li key={t.id} className="grid gap-2 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-ink">
                            {t.worker_name} · {t.assignment_title}
                          </span>
                          <Badge variant={t.status === "approved" ? "secondary" : "outline"}>{STATUS[t.status] ?? t.status}</Badge>
                        </div>
                        <p>
                          Week of {t.week_start}: {Number(t.regular_hours)} h × {usd(t.bill_rate)}
                          {Number(t.overtime_hours) > 0 && ` + ${Number(t.overtime_hours)} h overtime × ${usd(Number(t.bill_rate) * Number(t.ot_bill_multiplier))}`} ={" "}
                          <strong>{usd(t.billing)}</strong>
                        </p>
                        {t.notes && <p className="text-xs text-muted-foreground">CoreTech note: {t.notes}</p>}
                        {t.status === "rejected" && t.rejection_reason && <p className="text-xs text-muted-foreground">Your note: {t.rejection_reason}</p>}
                        {t.status === "submitted" && <TimesheetReview companyId={companyId} timesheetId={t.id} label={label} />}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))
      )}
    </Container>
  );
}
