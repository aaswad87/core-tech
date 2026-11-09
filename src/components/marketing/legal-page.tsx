import { TriangleAlertIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Set to true only after qualified counsel has reviewed the Privacy Policy and Terms of Use.
 * While false, both pages show a visible "pending legal review" notice.
 */
export const LEGAL_REVIEWED = false;

type LegalPageProps = {
  title: string;
  path: string;
  lastUpdated: string;
  children: React.ReactNode;
};

export function LegalPage({ title, path, lastUpdated, children }: LegalPageProps) {
  return (
    <>
      <PageHero title={title} breadcrumbs={[{ title, href: path }]} />
      <Container className="max-w-3xl py-14">
        {!LEGAL_REVIEWED && (
          <Alert className="mb-8 border-amber-300 bg-amber-50 text-amber-950">
            <TriangleAlertIcon />
            <AlertDescription className="text-amber-950">
              Draft — this document is pending legal review and may change.
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        <div className="mt-6 space-y-8 text-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_p]:leading-relaxed [&_section]:space-y-3 [&_ul]:space-y-1.5">
          {children}
        </div>
      </Container>
    </>
  );
}
