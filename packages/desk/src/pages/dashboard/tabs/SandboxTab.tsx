/**
 * SandboxTab — wraps the existing page component so legacy hashes keep their exact
 * DOM. Reimplementing here would break the 61 Playwright tests that assert on
 * the originals' headings and controls.
 */
import { SandboxPage } from "../../sandbox/SandboxPage";

export function SandboxTab() {
  return <SandboxPage />;
}
