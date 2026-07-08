import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  it("renders the app heading", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { level: 1, name: "ratemymusic" });
    expect(heading).not.toBeNull();
    expect(heading.textContent).toBe("ratemymusic");
  });
});
