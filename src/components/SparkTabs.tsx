import { t, useI18n } from "../i18n";
import { memo, useEffect, useState, useRef, useCallback } from "react";
import type { SparkSnapshot } from "../api/types";
import { isLlmMonitoringEnabled } from "../api/sparkRole";
import { PlusIcon, GridIcon, BotIcon, ComfyIcon } from "./ui/icons";
import { OVERVIEW_ID, LLM_ID, COMFY_ID } from "../constants";

interface SparkTabsProps {
  sparks: SparkSnapshot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit?: (id: string) => void;
}

/* ─── Mobile helpers ──────────────────────────────────── */

const MOBILE_BREAKPOINT = 768;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);

  useEffect(() => {
    let ticking = false;
    const handler = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return isMobile;
}

function HamburgerIcon({ className = "" }: { className?: string }) {
  useI18n();
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

/**
 * Label + online-dot only. Memoized on primitives (#8a) so 2s WS frames that
 * rebuild the parent `spark` object do not reconcile the label. The drag
 * handle stays *outside* this memo so useSortable's fresh listeners/ref always
 * attach (excluding dragHandleProps from a whole-pill memo was stale-risk).
 */
const TabLabelButton = memo(
  function TabLabelButton({
    id,
    name,
    online,
    isActive,
    onSelect,
    onEdit,
  }: {
    id: string;
    name: string;
    online: boolean;
    isActive: boolean;
    onSelect: (id: string) => void;
    onEdit?: (id: string) => void;
  }) {
    return (
      <button
        type="button"
        onClick={() => onSelect(id)}
        onDoubleClick={() => onEdit?.(id)}
        className="pill-label"
        aria-current={isActive ? "page" : undefined}
      >
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            online ? "bg-success" : "bg-danger"
          }`}
        />
        {name}
      </button>
    );
  },
  (prev, next) =>
    prev.id === next.id &&
    prev.name === next.name &&
    prev.online === next.online &&
    prev.isActive === next.isActive &&
    prev.onSelect === next.onSelect &&
    prev.onEdit === next.onEdit
);

/**
 * Pill-nav tab item. Active = dark pill (via .pill-item-with-handle).
 */
function TabChrome({
  spark,
  isActive,
  onSelect,
  onEdit,
}: {
  spark: SparkSnapshot;
  isActive: boolean;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  useI18n();
  return (
    <div
      className={["pill-item-with-handle shrink-0", isActive ? "is-active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <TabLabelButton
        id={spark.id}
        name={spark.name}
        online={spark.online}
        isActive={isActive}
        onSelect={onSelect}
        onEdit={onEdit}
      />
    </div>
  );
}

export function SparkTabs({
  sparks,
  activeId,
  onSelect,
  onAdd,
  onEdit,
}: SparkTabsProps) {
  useI18n();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showLlmTab = sparks.some(isLlmMonitoringEnabled);
  const showComfyTab = sparks.some((s) => Boolean(s.comfyMonitoring));
  // Service liveness dots — green when at least one unit's service is reachable.
  const llmOnline = sparks.some((s) =>
    isLlmMonitoringEnabled(s) && s.metrics?.llm?.some((l) => l.available)
  );
  const comfyOnline = sparks.some((s) => s.comfyMonitoring && s.metrics?.comfy?.available);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  // ── Mobile: hamburger + dropdown ────────────────────
  if (isMobile) {
    return (
      <div className="mobile-menu-wrapper">
        <button
          type="button"
          className="icon-circle"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={t("Select Spark")}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-spark-menu"
          title={t("Select Spark")}
        >
          <HamburgerIcon className="h-4 w-4" />
        </button>
        <MobileSparkMenu
          sparks={sparks}
          activeId={activeId}
          showLlm={showLlmTab}
          showComfy={showComfyTab}
          llmOnline={llmOnline}
          comfyOnline={comfyOnline}
          onSelect={onSelect}
          onAdd={onAdd}
          isOpen={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
      </div>
    );
  }

  // ── Desktop: pill-nav ───────────────────────────────

  return (
    <nav className="pill-nav" aria-label={t("Sparks")}>
      <OverviewTab isActive={activeId === OVERVIEW_ID} onSelect={onSelect} />
      {sparks.map((spark) => (
        <div key={spark.id} className="shrink-0">
          <TabChrome
            spark={spark}
            isActive={activeId === spark.id}
            onSelect={onSelect}
            onEdit={onEdit}
          />
        </div>
      ))}
      {/* Fleet-level LLM + Comfy tabs — peers of node pills, always after nodes. */}
      {showLlmTab && (
        <LlmTab isActive={activeId === LLM_ID} online={llmOnline} onSelect={onSelect} />
      )}
      {showComfyTab && (
        <ComfyTab isActive={activeId === COMFY_ID} online={comfyOnline} onSelect={onSelect} />
      )}
    </nav>
  );
}

function OverviewTab({
  isActive,
  onSelect,
}: {
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  useI18n();
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => onSelect(OVERVIEW_ID)}
        className={`pill-item ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <GridIcon className="h-3.5 w-3.5" />
        {t("Overview")}</button>
    </div>
  );
}

/** Fleet-level LLM stats tab pill — peer of node pills, placed after them. */
function LlmTab({
  isActive,
  online,
  onSelect,
}: {
  isActive: boolean;
  online: boolean;
  onSelect: (id: string) => void;
}) {
  useI18n();
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => onSelect(LLM_ID)}
        className={`pill-item ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span
          className={`mr-1.5 inline-block h-2 w-2 rounded-full ${online ? "bg-success" : "bg-danger"}`}
          aria-hidden
        />
        <BotIcon className="h-3.5 w-3.5" />
        LLM</button>
    </div>
  );
}

/** Fleet-level ComfyUI tab pill — peer of node pills, placed after LLM. */
function ComfyTab({
  isActive,
  online,
  onSelect,
}: {
  isActive: boolean;
  online: boolean;
  onSelect: (id: string) => void;
}) {
  useI18n();
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => onSelect(COMFY_ID)}
        className={`pill-item ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
      >
        <span
          className={`mr-1.5 inline-block h-2 w-2 rounded-full ${online ? "bg-success" : "bg-danger"}`}
          aria-hidden
        />
        <ComfyIcon className="h-3.5 w-3.5" />
        {t("Comfy")}</button>
    </div>
  );
}

/* ─── Mobile dropdown menu ────────────────────────────── */

function MobileSparkMenu({
  sparks,
  activeId,
  showLlm,
  showComfy,
  llmOnline,
  comfyOnline,
  onSelect,
  onAdd,
  isOpen,
  onClose,
}: {
  sparks: SparkSnapshot[];
  activeId: string | null;
  showLlm?: boolean;
  showComfy?: boolean;
  llmOnline?: boolean;
  comfyOnline?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  const handleItemClick = useCallback(
    (id: string) => {
      onSelect(id);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleAddClick = useCallback(() => {
    onAdd();
    onClose();
  }, [onAdd, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer to avoid the click that just opened the menu
    const id = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div id="mobile-spark-menu" ref={menuRef} className="mobile-spark-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        className={`mobile-menu-item ${activeId === OVERVIEW_ID ? "is-active" : ""}`}
        aria-current={activeId === OVERVIEW_ID ? "page" : undefined}
        onClick={() => handleItemClick(OVERVIEW_ID)}
      >
        <GridIcon className="h-3.5 w-3.5" />
        {t("Overview")}</button>
      {sparks.map((spark) => (
        <button
          key={spark.id}
          type="button"
          role="menuitem"
          className={`mobile-menu-item ${activeId === spark.id ? "is-active" : ""}`}
          aria-current={activeId === spark.id ? "page" : undefined}
          onClick={() => handleItemClick(spark.id)}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              spark.online ? "bg-success" : "bg-danger"
            }`}
          />
          {spark.name}
        </button>
      ))}
      {showLlm && (
        <button
          type="button"
          role="menuitem"
          className={`mobile-menu-item ${activeId === LLM_ID ? "is-active" : ""}`}
          aria-current={activeId === LLM_ID ? "page" : undefined}
          onClick={() => handleItemClick(LLM_ID)}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              llmOnline ? "bg-success" : "bg-danger"
            }`}
          />
          <BotIcon className="h-3.5 w-3.5" />
          LLM
        </button>
      )}
      {showComfy && (
        <button
          type="button"
          role="menuitem"
          className={`mobile-menu-item ${activeId === COMFY_ID ? "is-active" : ""}`}
          aria-current={activeId === COMFY_ID ? "page" : undefined}
          onClick={() => handleItemClick(COMFY_ID)}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              comfyOnline ? "bg-success" : "bg-danger"
            }`}
          />
          <ComfyIcon className="h-3.5 w-3.5" />
          {t("Comfy")}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="mobile-menu-item mobile-menu-add"
        onClick={handleAddClick}
      >
        <PlusIcon className="h-3.5 w-3.5" />
        {t("Add Spark/GPU Host")}</button>
    </div>
  );
}