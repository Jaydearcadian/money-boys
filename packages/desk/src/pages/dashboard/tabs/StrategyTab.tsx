/**
 * StrategyTab — wraps the existing page component so legacy hashes keep their exact
 * DOM. Reimplementing here would break the 61 Playwright tests that assert on
 * the originals' headings and controls.
 */
import { Track1Page } from "../../track1/Track1Page";

export function StrategyTab() {
  return <Track1Page />;
}
