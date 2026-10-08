/**
 * DeskTab — wraps the existing page component so legacy hashes keep their exact
 * DOM. Reimplementing here would break the 61 Playwright tests that assert on
 * the originals' headings and controls.
 */
import { DeskPage } from "../../Desk";

export function DeskTab() {
  return <DeskPage />;
}
