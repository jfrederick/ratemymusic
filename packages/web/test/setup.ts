import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// The web vitest project doesn't run with `globals: true`, so Testing Library's
// auto-cleanup doesn't register itself. Do it explicitly so DOM from one test doesn't
// leak into the next (duplicate elements causing "found multiple" query errors).
afterEach(() => {
  cleanup();
});
