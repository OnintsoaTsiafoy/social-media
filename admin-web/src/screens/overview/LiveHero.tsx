import type { LiveActivity, Network, PageCounts } from "@/api/types";
import { NetGlyph } from "@/components/Network";
import { FEED_TAG_TONE } from "@/domain/overview";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/css";
import { NET_LABEL } from "@/lib/network";
import { useAdmin } from "@/state/AdminContext";

interface LiveHeroProps {
  live: LiveActivity | null;
  pages: PageCounts;
}

export function LiveHero({ live, pages }: LiveHeroProps) {
  const { t, format } = useI18n();
  const { net, setNet } = useAdmin();

  const toggle = (target: Network) => setNet((current) => (current === target ? "all" : target));

  return (
    <section className="hero" aria-label={t("overview.hero.aria")}>
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
            stroke="var(--lime)"
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
            aria-label={t("overview.hero.showFacebook")}
            aria-pressed={net === "facebook"}
            onClick={() => toggle("facebook")}
          >
            <NetGlyph net="facebook" size={38} radius={12} fontSize={21} />
          </button>
        </div>
        <div className="orbit__arm orbit__arm--ig">
          <button
            type="button"
            className="orbit__chip orbit__chip--ig"
            aria-label={t("overview.hero.showInstagram")}
            aria-pressed={net === "instagram"}
            onClick={() => toggle("instagram")}
          >
            <NetGlyph net="instagram" size={36} radius={12} fontSize={21} iconSize={19} strokeWidth={1.8} />
          </button>
        </div>
        <div className="orbit__arm orbit__arm--dot-a" aria-hidden="true">
          <div className="orbit__dot-a" />
        </div>
        <div className="orbit__arm orbit__arm--dot-b" aria-hidden="true">
          <div className="orbit__dot-b" />
        </div>

        <div className="orbit__core">
          <div className="orbit__rate">{live ? format.int(live.commentsLastHour) : "—"}</div>
          <div className="orbit__unit">{t("overview.hero.unit")}</div>
        </div>
      </div>

      <div className="stream">
        <div>
          <div className="stream__eyebrow">
            <span className="stream__dot" />
            <span className="stream__label">{t("overview.stream.eyebrow", { network: t(NET_LABEL[net]) })}</span>
          </div>
          <div className="stream__title">{t("overview.stream.title")}</div>
        </div>

        <div className="pills" role="group" aria-label={t("overview.stream.filter")}>
          <button type="button" className={cx("pill", "pill--all")} aria-pressed={net === "all"} onClick={() => setNet("all")}>
            {t("network.all")}
            <span className="pill__count">{pages.all}</span>
          </button>
          <button
            type="button"
            className={cx("pill", "pill--fb")}
            aria-pressed={net === "facebook"}
            onClick={() => toggle("facebook")}
          >
            <NetGlyph net="facebook" size={26} radius={9} fontSize={15} />
            {t("network.facebook")}
            <span className="pill__count">{pages.facebook}</span>
          </button>
          <button
            type="button"
            className={cx("pill", "pill--ig")}
            aria-pressed={net === "instagram"}
            onClick={() => toggle("instagram")}
          >
            <NetGlyph net="instagram" size={26} radius={9} fontSize={15} iconSize={15} />
            {t("network.instagram")}
            <span className="pill__count">{pages.instagram}</span>
          </button>
        </div>

        {live && live.feed.length > 0 ? (
          <ul className="feed">
            {live.feed.map((item) => (
              <li className="feed__item" key={item.id} title={`${item.page} · ${format.relative(new Date(item.at))}`}>
                <NetGlyph net={item.network} size={24} radius={8} fontSize={13}>
                  {item.network === "facebook" ? "f" : "◎"}
                </NetGlyph>
                <span className="feed__text">“{item.text}”</span>
                <span className="feed__tag" data-tone={FEED_TAG_TONE[item.tag]}>
                  {t(`feed.tag.${item.tag}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="feed__empty">{t("overview.stream.empty")}</p>
        )}
      </div>
    </section>
  );
}
