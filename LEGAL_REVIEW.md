# HelmetCamHeroes publication review

Reviewed 21 November 2026 against the repository and official EU/Lithuanian guidance. The code changes reduce unsolicited external data transfers. They do not establish permission to publish personal data or complete the missing operator facts. This is not a certification of legal compliance.

## Required owner details before publishing the revised notice

- Supply the controller's actual legal name, operating country, and monitored private contact. Replace the visible pending paragraphs in `about.html`; a brand and public YouTube comments are insufficient.
- Confirm the purpose, lawful basis, source and retention/review criteria for published driver names, session dates/venues, performance data and identifiable footage. Do not assume consent or legitimate interests without documenting the actual circumstances. Provide Articles 13/14 information to affected people as applicable. Remove or de-identify material that lacks a valid basis; review footage/image permissions, including children, separately.
- Confirm GitHub Pages/Cloudflare settings, actual logging and any injected analytics, provider roles, retention and applicable transfer safeguards. The repository cannot establish production dashboard settings or provider agreements.
- Add a workable private correction/removal/rights-request route. Handle requests within applicable GDPR deadlines (normally one month), verify identity proportionately, and keep necessary request records securely. Review raw JSON, generated summaries, championship data, video titles/thumbnails and source history when correcting or removing a record. A public Git repository and cached copies can retain old data.
- Review sponsorship, advertising, sales or business activities separately if present. They are not established by this repository.

## Implemented technical changes

- YouTube thumbnails, map tiles and remote networking require separate explicit actions. Existing YouTube player consent is retained, with terms and privacy links.
- Disable/reload controls reset optional media choices. Remote disable/disconnect destroys networking and stops retries. No new persistent consent identifier was introduced.
- Leaflet, PeerJS and QRCode.js are served locally with licence notices; Google Fonts/preconnect calls were removed.
- The map no longer persists a location-derived viewport. Near me remains behind explicit map activation and separate browser geolocation permission.
- The privacy page describes browser storage and external connections, publication concerns and rights. Missing facts remain explicitly identified instead of invented.

## Official references

- [GDPR, particularly Articles 5–7, 12–14, 15–22 and 44–49](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [VDAI 2025 cookie guidance](https://vdai.lrv.lt/public/canonical/1765784968/1188/2025-04-02_Slapuku%25CC%25A8%2520naudojimo%2520praktikos%2520apibendrinimas_new_galutinis.pdf)
- [EDPB video-device guidance, including public internet publication](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_201903_video_devices_en_0.pdf)
- [Lithuanian Civil Code, Article 2.22 on image rights](https://e-seimas.lrs.lt/rs/actualedition/TAIS.107687/KvajfUxFst/)
- [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [GitHub Pages IP logging](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Optional map/CDN requests can transmit personal data without cookies. Gating them is a conservative design choice; this review does not assert that every external request legally requires cookie consent.
