import { t, useI18n } from "../../i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMonthlyEnergy } from "../../api/client";
import type { MonthlyEnergy as MonthlyEnergyData, MonthlyEnergyMonth } from "../../api/types";
import { StackedBarChart, type BarSeries } from "../ui/StackedBarChart";
import { Tag } from "../ui/Tag";
import { formatKwh, formatMoney } from "./energyStats";
import {
  fleetCoverage,
  monthLabel,
  monthNodeRows,
  monthOptions,
  nodeColors,
  yearBars,
  yearOptions,
  yearTotalKwh,
} from "./monthlyStats";

const REFRESH_MS = 5 * 60_000;
const pct = (v: number) => `${(v * 100).toFixed(v >= 0.995 ? 0 : 1)}%`;

interface ViewProps {
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  price: number | null;
  currency: string;
}

/** Permanent monthly totals: pick a month for per-node figures, or a year for twelve bars. */
export function MonthlyEnergy({
  nameOf,
  price,
  currency,
  reloadToken = 0,
}: {
  nameOf: (id: string) => string;
  price: number | null;
  currency: string;
  /** Change this value (e.g. after a Reset) to refetch immediately. */
  reloadToken?: number;
}) {
  useI18n();
  const [data, setData] = useState<MonthlyEnergyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "year">("month");
  const [month, setMonth] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  const load = useCallback(
    () =>
      fetchMonthlyEnergy()
        .then((next) => {
          setData(next);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err))),
    []
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  const lastToken = useRef(reloadToken);
  useEffect(() => {
    if (lastToken.current === reloadToken) return;
    lastToken.current = reloadToken;
    void load();
  }, [reloadToken, load]);

  const now = data?.generatedAt ?? 0;
  const months = useMemo(() => data?.months ?? [], [data]);
  const monthKeys = useMemo(() => monthOptions(months, now), [months, now]);
  const years = useMemo(() => yearOptions(months, now), [months, now]);
  const colorOf = useMemo(() => nodeColors(months), [months]);

  // Default to the newest month with data (or the current one), and this year.
  const activeMonth = month && monthKeys.includes(month) ? month : (months.at(-1)?.month ?? monthKeys[0]);
  const activeYear = year != null && years.includes(year) ? year : years[0];

  return (
    <section className="panel en-panel en-monthly" aria-labelledby="en-h-monthly">
      <header className="en-panel__head">
        <div>
          <h2 id="en-h-monthly">{t("Monthly history")}</h2>
          <p className="en-panel__sub">
            Totals per UTC month, kept permanently. They survive resets, restarts and changes to the fleet. Months are UTC, so they will not match a local-time electricity bill.
          </p>
        </div>
        {data && months.length > 0 ? (
          <div className="en-monthly__tools">
            <div className="seg" role="group" aria-label={t("Monthly view")}>
              <button type="button" aria-pressed={view === "month"} className={view === "month" ? "is-on" : ""} onClick={() => setView("month")}>{t("Month")}</button>
              <button type="button" aria-pressed={view === "year"} className={view === "year" ? "is-on" : ""} onClick={() => setView("year")}>{t("Year")}</button>
            </div>
            {view === "month" ? (
              <select className="en-select" aria-label={t("Month")} value={activeMonth} onChange={(e) => setMonth(e.target.value)}>
                {monthKeys.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
              </select>
            ) : (
              <select className="en-select" aria-label={t("Year")} value={activeYear} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
        ) : null}
      </header>

      {error && !data ? (
        <p className="en-panel__sub" role="alert">{t("Could not load monthly history:")} {error}</p>
      ) : !data ? (
        <p className="en-panel__sub" role="status">{t("Loading monthly history…")}</p>
      ) : months.length === 0 ? (
        <p className="en-panel__sub" role="status">
          Nothing archived yet. Each finished minute is added to its month once the Sparks have been reporting for a little while.
        </p>
      ) : view === "month" ? (
        <MonthView
          month={months.find((m) => m.month === activeMonth) ?? null}
          label={monthLabel(activeMonth)}
          now={now}
          nameOf={nameOf}
          colorOf={colorOf}
          price={price}
          currency={currency}
        />
      ) : (
        <YearView months={months} year={activeYear} nameOf={nameOf} colorOf={colorOf} price={price} currency={currency} />
      )}
    </section>
  );
}

function MonthView({
  month,
  label,
  now,
  nameOf,
  colorOf,
  price,
  currency,
}: ViewProps & { month: MonthlyEnergyMonth | null; label: string; now: number }) {
  useI18n();
  if (!month || month.totalWh <= 0) {
    return <p className="en-panel__sub" role="status">{t("No energy was recorded in")} {label}.</p>;
  }
  const rows = monthNodeRows(month, now, price);
  const kwh = month.totalWh / 1000;
  const cost = price != null ? kwh * price : null;
  const eff = month.whPerOutputToken != null ? month.whPerOutputToken * 1000 : null;
  return (
    <>
      <div className="en-monthly__stats" role="group" aria-label={`${label} summary`}>
        <div><span className="eyebrow">{t("Energy")}</span><b className="mono">{formatKwh(kwh)} {t("kWh")}</b></div>
        <div><span className="eyebrow">{t("Cost")}</span><b className="mono">{cost != null ? formatMoney(cost, currency) : "—"}</b></div>
        <div>
          <span className="eyebrow">{t("Efficiency")}</span>
          <b className="mono">{eff != null ? `${eff < 10 ? eff.toFixed(2) : eff.toFixed(1)} Wh / 1k tok` : "—"}</b>
        </div>
        <div><span className="eyebrow">{t("Fleet coverage")}</span><b className="mono">{pct(fleetCoverage(month, now))}</b></div>
        <div>
          <span className="eyebrow">{t("Status")}</span>
          <Tag tone={month.closed ? "good" : "warn"}>{month.closed ? "Closed" : "Open, still counting"}</Tag>
        </div>
      </div>
      <div className="en-table-wrap">
        <table className="en-table">
          <caption className="sr-only">{t("Energy by node for")} {label}</caption>
          <thead>
            <tr>
              <th scope="col" className="is-left">{t("Spark")}</th>
              <th scope="col">{t("Energy")}</th>
              <th scope="col">{t("Share")}</th>
              <th scope="col">{t("Coverage")}</th>
              <th scope="col">{t("Cost")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <th scope="row" className="en-table__name">
                  <i className="en-swatch" style={{ background: colorOf(n.id) }} aria-hidden="true" />
                  {nameOf(n.id)}
                </th>
                <td className="mono">{formatKwh(n.kwh)} {t("kWh")}</td>
                <td className="mono">{pct(n.share)}</td>
                <td className="mono">{pct(n.coverage)}</td>
                <td className="mono">{n.cost != null ? formatMoney(n.cost, currency) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="en-panel__sub en-panel__foot">
        Only the Sparks that reported in {label} are listed. Coverage is the share of the month each one was measured
        {month.closed ? "" : " so far"}. Estimated, not metered.
      </p>
    </>
  );
}

function YearView({
  months,
  year,
  nameOf,
  colorOf,
  price,
  currency,
}: ViewProps & { months: MonthlyEnergyMonth[]; year: number }) {
  useI18n();
  const bars = yearBars(months, year);
  const ids = [...new Set(bars.flatMap((b) => Object.keys(b.values)))];
  const series: BarSeries[] = ids.map((id) => ({ id, label: nameOf(id), color: colorOf(id) }));
  const total = yearTotalKwh(months, year);
  return (
    <>
      <p className="en-monthly__year">
        <b className="mono">{formatKwh(total)} {t("kWh")}</b> {t("in")} {year}
        {price != null && total > 0 ? <span> {t("· about")} {formatMoney(total * price, currency)}</span> : null}
      </p>
      <div className="legend" aria-label={t("Nodes")}>
        {series.map((s) => (
          <span key={s.id} style={{ "--c": s.color } as React.CSSProperties}>{s.label}</span>
        ))}
      </div>
      <StackedBarChart
        buckets={bars}
        series={series}
        height={220}
        format={formatKwh}
        unit="kWh"
        empty={`No energy recorded in ${year}.`}
        ariaLabel={`Energy in kWh per month, ${year}`}
      />
    </>
  );
}
