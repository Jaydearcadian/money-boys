import "./dashboard.css";
import { DeskProvider, useDesk, type TabId } from "./state";
import {
  Sidebar,
  TopHeader,
  KpiRow,
  BasisChart,
  DecisionFeed,
  ResultPanel,
  ReceiptDrawer,
  Card,
  Loading,
} from "./components";
import { AgentMatrix, AuditView, CopilotView, MarginGauge, RwaCards, SandboxLab, StrategyView, TelemetryBar } from "./views";

function DashboardContent() {
  const { tab, records, recordsError, run } = useDesk();

  return (
    <div className="db-shell">
      <Sidebar />
      <main className="db-main">
        <TopHeader />
        <KpiRow />

        {tab === "cockpit" && (
          <>
            <TelemetryBar />
            <RwaCards />
            <div className="db-row-split">
              <AgentMatrix />
              <MarginGauge />
            </div>
            <div className="db-row-split">
              {records ? <BasisChart trades={records.trades} /> : <Loading error={recordsError} />}
              <DecisionFeed limit={6} />
            </div>
            <Card title="Interactive Scenario Sandbox" aside={<span className="db-label">Runs real engine code</span>}>
              <div style={{ marginTop: 4 }}>
                <ResultPanel run={run} />
              </div>
            </Card>
          </>
        )}

        {tab === "strategy" && <StrategyView />}
        {tab === "copilot" && <CopilotView />}
        {tab === "audit" && <AuditView />}
        {tab === "sandbox" && <SandboxLab />}
      </main>
      <ReceiptDrawer />
    </div>
  );
}

export function DashboardPage({ initialTab = "cockpit" }: { initialTab?: TabId }) {
  return (
    <DeskProvider initialTab={initialTab}>
      <DashboardContent />
    </DeskProvider>
  );
}
