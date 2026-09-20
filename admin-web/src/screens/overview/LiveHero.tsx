import { NetGlyph } from "@/components/Network";
import { FEED_POOL, FEED_TAG_TONE, NETWORK_PAGE_COUNTS } from "@/data/overview";
import { cx } from "@/lib/css";
import { formatInt } from "@/lib/format";
import { matchesNet, NET_LABEL } from "@/lib/network";
import { useAdmin } from "@/state/AdminContext";
import type { NetFilter } from "@/types";

export function LiveHero() {
  const { net, setNet, ticker } = useAdmin();

  const stream = ticker.feed.flatMap((entry) => {
    const event = FEED_POOL[entry.poolIndex];
    return event && matchesNet(net, event.net) ? [{ key: entry.key, event }] : [];
  });

  const toggle = (target: Exclude<NetFilter, "all">) =>
    setNet((current) => (current === target ? "all" : target));

  return (
    <section className="hero" aria-label="Live activity">
      <div className="hero__glow" aria-hidden="true" />

      <div className="orbit">
        <div className="orbit__ring orbit__ring--outer" aria-hidden="true" />
        <div className="orbit__ring orbit__ring--dashed" aria-hidden="true" />
        <div className="orbit__ring orbit__ring--inner" aria-hidden="true" />
        <div className="orbit__ring orbit__ring--halo" aria-hidden="true" />
        <svg className="orbit__dash" width="290" height="290" viewBox="0 0 290 290" aria-hidden="true">
          <circle
            cx="145"
            cy="145"
            r="144"
            fill="none"
            stroke="#C4F04A"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="26 64"
            opacity="0.65"
          />
        </svg>

        <div className="orbit__arm orbit__arm--fb">
          <button
            type="button"
            className="orbit__chip orbit__chip--fb"
            aria-label="Show Facebook only"
            aria-pressed={net === "fb"}
            onClick={() => toggle("fb")}
          >
            <NetGlyph net="FB" size={38} radius={12} fontSize={21} />
          </button>
        </div>
        <div className="orbit__arm orbit__arm--ig">
          <button
            type="button"
            className="orbit__chip orbit__chip--ig"
            aria-label="Show Instagram only"
            aria-pressed={net === "ig"}
            onClick={() => toggle("ig")}
          >
            <NetGlyph net="IG" size={36} radius={12} fontSize={21} iconSize={19} strokeWidth={1.8} />
          </button>
        </div>
        <div className="orbit__arm orbit__arm--dot-a" aria-hidden="true">
          <div className="orbit__dot-a" />
        </div>
        <div className="orbit__arm orbit__arm--dot-b" aria-hidden="true">
          <div className="orbit__dot-b" />
        </div>

        <div className="orbit__core">
          <div className="orbit__rate">{formatInt(ticker.liveRate)}</div>
          <div className="orbit__unit">COMMENTS / MIN</div>
        </div>
      </div>

      <div className="stream">
        <div>
          <div className="stream__eyebrow">
            <span className="stream__dot" />
            <span className="stream__label">LIVE STREAM · {NET_LABEL[net]}</span>
          </div>
          <div className="stream__title">Everything your managers see, as it lands</div>
        </div>

        <div className="pills" role="group" aria-label="Filter by network">
          <button
            type="button"
            className={cx("pill", "pill--all")}
            aria-pressed={net === "all"}
            onClick={() => setNet("all")}
          >
            All networks<span className="pill__count">{NETWORK_PAGE_COUNTS.all}</span>
          </button>
          <button
            type="button"
            className={cx("pill", "pill--fb")}
            aria-pressed={net === "fb"}
            onClick={() => toggle("fb")}
          >
            <NetGlyph net="FB" size={26} radius={9} fontSize={15} />
            Facebook<span className="pill__count">{NETWORK_PAGE_COUNTS.fb}</span>
          </button>
          <button
            type="button"
            className={cx("pill", "pill--ig")}
            aria-pressed={net === "ig"}
            onClick={() => toggle("ig")}
          >
            <NetGlyph net="IG" size={26} radius={9} fontSize={15} iconSize={15} />
            Instagram<span className="pill__count">{NETWORK_PAGE_COUNTS.ig}</span>
          </button>
        </div>

        <ul className="feed">
          {stream.map(({ key, event }) => (
            <li className="feed__item" key={key}>
              <NetGlyph net={event.net} size={24} radius={8} fontSize={13}>
                {event.net === "FB" ? "f" : "◎"}
              </NetGlyph>
              <span className="feed__text">{event.text}</span>
              <span className="feed__tag" data-tone={FEED_TAG_TONE[event.tag]}>
                {event.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
