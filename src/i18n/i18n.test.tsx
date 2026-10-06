import { act, useEffect, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanupRenders, render } from "../testing/render";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { initializeLanguage, setLanguage, t, translate, useI18n } from "./index";
import chinese from "./zh-CN.json";

afterEach(() => {
  cleanupRenders();
  act(() => setLanguage("en"));
});

it("loads the configured default without overriding a later manual selection", () => {
  initializeLanguage("zh-CN");
  expect(t("Settings")).toBe("设置");
  setLanguage("en");
  initializeLanguage("zh-CN");
  expect(t("Settings")).toBe("Settings");
});

it("switches visible text and accessible labels immediately without losing component state", () => {
  let mounts = 0;
  function Fixture() {
    useI18n();
    const [draft, setDraft] = useState("dgx01");
    useEffect(() => { mounts += 1; }, []);
    return <>
      <LanguageSwitch />
      <h1>{t("Overview")}</h1>
      <button title={t("Settings")} data-testid="edit" onClick={() => setDraft("my-edited-node")}>{t("Edit")}</button>
      <input aria-label="draft" value={draft} readOnly />
    </>;
  }
  const { container } = render(<Fixture />);
  act(() => (container.querySelector('[data-testid="edit"]') as HTMLButtonElement).click());
  act(() => (container.querySelector('[aria-label="切换为中文"]') as HTMLButtonElement).click());
  expect(container.querySelector("h1")?.textContent).toBe("概览");
  expect(container.querySelector('[data-testid="edit"]')?.getAttribute("title")).toBe("设置");
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("my-edited-node");
  expect(document.documentElement.lang).toBe("zh-CN");
  act(() => (container.querySelector('[aria-label="Switch to English"]') as HTMLButtonElement).click());
  expect(container.querySelector("h1")?.textContent).toBe("Overview");
  expect((container.querySelector("input") as HTMLInputElement).value).toBe("my-edited-node");
  expect(mounts).toBe(1);
});

it("preserves English spacing, dynamic values and unknown model or device names", () => {
  expect(translate(" Current ", "en")).toBe(" Current ");
  expect(translate(" ", "zh-CN")).toBe(" ");
  expect(translate("Port {0}", "zh-CN", 8888)).toBe("端口 8888");
  expect(translate("dgx01", "zh-CN")).toBe("dgx01");
  expect(translate("GLM-5.3-Flash-NVFP4", "zh-CN")).toBe("GLM-5.3-Flash-NVFP4");
});

it("has no translation placeholders that cannot be filled from the English text", () => {
  for (const [english, translated] of Object.entries(chinese)) {
    const source = new Set(english.match(/\{\d+\}/g) ?? []);
    for (const placeholder of translated.match(/\{\d+\}/g) ?? []) expect(source.has(placeholder), english).toBe(true);
  }
});
