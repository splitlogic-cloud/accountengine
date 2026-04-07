import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import { ConnectForm }      from './ConnectForm'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function IntegrationsPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: integrations } = await supabase
    .from('integrations')
    .select('*')
    .eq('company_id', companyId)

  const byProvider = Object.fromEntries(
    (integrations ?? []).map(i => [i.provider, i])
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.vercel.app'

  type IntegrationField = {
    key: string
    label: string
    placeholder: string
    type: 'text' | 'password'
  }

  type IntegrationProvider = {
    id: string
    name: string
    icon: string
    color: string
    description: string
    webhook_url: string
    fields: IntegrationField[]
    docs: string
    events: string[]
  }

  const providers: IntegrationProvider[] = [
    {
      id:          'stripe',
      name:        'Stripe',
      icon:        '💳',
      color:       'bg-[#635bff]',
      description: 'Automatisk bokföring av charges, refunds, fees och payouts.',
      webhook_url: `${appUrl}/api/webhooks/stripe`,
      fields: [
        { key: 'secret_key',     label: 'Secret key',     placeholder: 'sk_live_...',   type: 'password' },
        { key: 'webhook_secret', label: 'Webhook secret', placeholder: 'whsec_...',      type: 'password' },
      ],
      docs: 'https://dashboard.stripe.com/webhooks',
      events: ['charge.succeeded', 'charge.refunded', 'payout.paid'],
    },
    {
      id:          'shopify',
      name:        'Shopify',
      icon:        '🛍️',
      color:       'bg-[#96bf48]',
      description: 'Bokför orders, refunds och payouts från Shopify Payments.',
      webhook_url: `${appUrl}/api/webhooks/shopify`,
      fields: [
        { key: 'shop_domain',     label: 'Shop domain',     placeholder: 'mitt-bolag.myshopify.com', type: 'text' },
        { key: 'webhook_secret',  label: 'Webhook secret',  placeholder: 'shopify-webhook-secret',   type: 'password' },
      ],
      docs: 'https://admin.shopify.com/settings/notifications',
      events: ['orders/paid', 'refunds/create', 'payouts/paid'],
    },
    {
      id:          'paypal',
      name:        'PayPal',
      icon:        '🅿️',
      color:       'bg-[#003087]',
      description: 'Bokför betalningar, refunds och avgifter från PayPal.',
      webhook_url: `${appUrl}/api/webhooks/paypal`,
      fields: [
        { key: 'client_id',     label: 'Client ID',     placeholder: 'PayPal Client ID',  type: 'text' },
        { key: 'client_secret', label: 'Client Secret', placeholder: 'PayPal Secret',     type: 'password' },
        { key: 'webhook_id',    label: 'Webhook ID',    placeholder: 'WH-...',            type: 'text' },
      ],
      docs: 'https://developer.paypal.com/dashboard/webhooks',
      events: ['PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REFUNDED'],
    },
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[17px] font-bold tracking-tight">Integrationer</h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">
          Koppla betalningslösningar för automatisk bokföring via financial events.
        </p>
      </div>

      <div className="grid gap-5">
        {providers.map(provider => {
          const existing = byProvider[provider.id]
          const isActive = existing?.is_active === true

          return (
            <div key={provider.id} className={`bg-white border rounded-[10px] shadow-sm overflow-hidden ${
              isActive ? 'border-[#1a7a3c]' : 'border-[#e2e8f0]'
            }`}>
              {/* Header */}
              <div className="flex items-center gap-4 px-5 py-4 border-b border-[#e2e8f0]">
                <div className={`w-10 h-10 ${provider.color} rounded-[8px] flex items-center justify-center text-xl shrink-0`}>
                  {provider.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-bold">{provider.name}</span>
                    {isActive && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#dcfce7] text-[#15803d]">
                        ✓ Ansluten
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[#64748b] mt-0.5">{provider.description}</p>
                </div>
                <a
                  href={provider.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-[#64748b] hover:text-[#0f172a] transition-colors"
                >
                  Docs →
                </a>
              </div>

              <div className="px-5 py-4">
                {/* Webhook URL */}
                <div className="mb-4">
                  <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                    Webhook URL — klistra in i {provider.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-[12px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[6px] px-3 py-2 text-[#334155] truncate">
                      {provider.webhook_url}
                    </code>
                    <CopyButton text={provider.webhook_url} />
                  </div>
                </div>

                {/* Events to subscribe to */}
                <div className="mb-4">
                  <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">
                    Prenumerera på dessa events
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.events.map(e => (
                      <span key={e} className="font-mono text-[11px] bg-[#f1f5f9] text-[#475569] px-2 py-0.5 rounded-[4px]">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Connect form */}
                <ConnectForm
                  companyId={companyId}
                  provider={provider.id}
                  fields={provider.fields}
                  existing={existing ?? null}
                  isActive={isActive}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="h-8 px-3 border border-[#e2e8f0] bg-white text-[12px] font-semibold text-[#334155] rounded-[6px] hover:bg-[#f1f5f9] transition-colors shrink-0"
      onClick={undefined}
    >
      Kopiera
    </button>
  )
}
