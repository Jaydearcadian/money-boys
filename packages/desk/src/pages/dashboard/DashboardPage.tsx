import type { ReactNode } from "react";
import { DashboardLayout, type DashboardTab } from "../../layouts/DashboardLayout";
import { DeskTab } from "./tabs/DeskTab";
import { SandboxTab } from "./tabs/SandboxTab";
import { StrategyTab } from "./tabs/StrategyTab";
import { AuditTab } from "./tabs/AuditTab";

const TAB_FOR: Record<DashboardTab, ReactNode> = {
  desk: <DeskTab />,
  sandbox: <SandboxTab />,
  strategy: <StrategyTab />,
  audit: <AuditTab />,
};

export function DashboardPage({ initialTab }: { initialTab: DashboardTab }) {
  return <DashboardLayout initialTab={initialTab}>{TAB_FOR[initialTab]}</DashboardLayout>;
}
