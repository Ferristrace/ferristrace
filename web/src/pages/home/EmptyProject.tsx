import { Rocket } from 'lucide-react'
import { SafeLink } from '@/components/ft/panels/SafeLink'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ft/bits'
import { otlpBase } from '@/data/onboarding'

export function EmptyProject() {
  return (
    <>
      <PageHeader title="Overview" meta="no signals yet" />
      <EmptyState
        icon={<Rocket />}
        title="No signals yet"
        code={`OTEL_SERVICE_NAME=checkout-api\nOTEL_EXPORTER_OTLP_ENDPOINT=${otlpBase()}\nOTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer <ingest key>"`}
        actions={<Button asChild size="sm" variant="primary"><SafeLink to="/onboarding">Connect your first service</SafeLink></Button>}
      >
        This page fills in as soon as your first span, log record or metric point arrives. Set three environment variables in any OpenTelemetry SDK and restart your service.
      </EmptyState>
    </>
  )
}
