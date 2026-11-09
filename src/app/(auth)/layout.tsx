import { Container } from "@/components/layout/container";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface">
      <Container className="flex min-h-[calc(100dvh-4rem)] items-start justify-center py-12 sm:items-center">
        {children}
      </Container>
    </div>
  );
}
