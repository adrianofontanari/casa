# Credits

Everything in Casa that was not made for Casa is listed here, with its source, its licence and the date the licence was checked. Casa's own code, pixel art and sounds produced by the code are covered by Casa's [licence](../../LICENSE): PolyForm Noncommercial 1.0.0 with a permission for use at work. The items below keep their own licences.

Rule for contributors to this file: one entry per item, with **URL**, **licence** (name and link), **date checked** (YYYY-MM-DD) and **how Casa uses it**. Nothing ships without an entry.

## Music

Lofi tracks played by the headphones. The files are attached to this repository's GitHub releases and downloaded only when you press play.

| Title | Artist | Source URL | Licence | Checked | Notes |
|---|---|---|---|---|---|
| Snow Drift (album "Winter Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/winter-lofi/snow-drift/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-snow-drift.m4a` |
| Fire Place (album "Winter Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/winter-lofi/fire-place/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-fire-place.m4a` |
| Winter Blues (album "Winter Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/winter-lofi/winter-blues/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-winter-blues.m4a` |
| Spring At Last (album "Spring at last (LOFI TAPE)") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/spring-at-last/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-spring-at-last.m4a` |
| April Showers (album "Spring at last (LOFI TAPE)") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/april-showers/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-april-showers.m4a` |
| Calm Currents (album "Public Domain Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/calm-currents-lofi-relax-calm/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-calm-currents.m4a` |
| Peaceful Drift (album "Public Domain Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/peaceful-drift-lofi-nostalgic-calm/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-peaceful-drift.m4a` |
| Ease into Night (album "Public Domain Lofi") | HoliznaCC0 | https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/ease-into-night-lofi-relax-chill/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 2026-11-09 | `holizna-ease-into-night.m4a` |

Each track page says, in its licence box: "<title> by HoliznaCC0 is licensed under a CC0 1.0 Universal License" (checked on every page on 2026-11-09; `LIVE=1 node --test test/unit/integrations-music.test.js` re-checks them and saves `test/evidence/live-music-licences.json`). CC0 needs no attribution; Casa credits the artist anyway. The files were re-encoded from the 320 kbps MP3 originals (48 MB in total) to AAC 128 kbps `.m4a` (23 MB) with macOS `afconvert`; CC0 allows changes. They are uploaded as assets of the GitHub release `music-v1` and are not committed (`assets/music/` is in `.gitignore`).

Ambient sounds (sea, rain, fire, birds) are synthesised by Casa's code and use no recordings.

## Webcam

The default webcam view in the window, in San Francisco.

| Source | Image URL | Terms or licence | Checked | Notes |
|---|---|---|---|---|
| NOAA National Data Buoy Center, BuoyCAM on station 46026 "SAN FRANCISCO - 18NM West of San Francisco, CA" (https://www.ndbc.noaa.gov/station_page.php?station=46026) | Latest file name from https://www.ndbc.noaa.gov/buoycams.php, image at `https://www.ndbc.noaa.gov/images/buoycam/<name>.jpg` | Public domain, U.S. Government work. NDBC is part of the National Weather Service and its site footer links its disclaimer to https://www.weather.gov/disclaimer, which says: "The information on National Weather Service (NWS) Web pages are in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose so long as you do not: 1) claim it is your own (e.g., by claiming copyright for NWS information -- see below), 2) use it in a manner that implies an endorsement or affiliation with NOAA/NWS, or 3) modify its content and then present it as official government material." | 2026-11-09 | Casa shows the image with the credit "NOAA National Data Buoy Center, station 46026" and the capture time (UTC in the file name and the caption), never as official material, and implies no endorsement. The JPEG is six views around the buoy (a sea horizon, not the city); night captures are dark and the camera is sometimes offline (`img: null` in the list), then the window says so. |

Candidates checked on 2026-11-09 and **not** used: Caltrans CCTV snapshots (no licence published); the NPS Golden Gate webcams page (https://www.nps.gov/goga/learn/photosmultimedia/webcams.htm) lists only third-party cameras (Fort Funston hang-gliding club, Muir Beach, Mt. Tam, WebCOOS Stinson Beach) and says the Alcatraz webcams are offline; WebCOOS (NOAA IOOS funded) needs an API token; the Golden Gate National Parks Conservancy webcams fall under its terms of use, which forbid copying or publicly displaying its content (https://www.parksconservancy.org/about/terms-use); Weather Underground user cams, oceanbeach.org, ABC7 and commercial streams publish no reuse licence.

## Weather & air

| Service | URL | Licence and attribution | Checked |
|---|---|---|---|
| Open-Meteo Forecast API | https://open-meteo.com/en/docs | Data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Licence page (https://open-meteo.com/en/licence): "You must include a link next to any location Open-Meteo data are displayed", e.g. `<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>`. Terms (https://open-meteo.com/en/terms): the free API is for non-commercial use only, under 10,000 calls a day, 5,000 an hour and 600 a minute (limits per IP and application); non-commercial includes "Private or non-profit websites or apps that do not have subscriptions or advertising"; commercial includes "Commercial products or promotional activities". | 2026-11-09 |
| Open-Meteo Geocoding API | https://open-meteo.com/en/docs/geocoding-api | Same Open-Meteo terms; the page's attribution reads "Location data based on GeoNames" ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). | 2026-11-09 |
| Open-Meteo Air Quality API | https://open-meteo.com/en/docs/air-quality-api | Same Open-Meteo terms, plus: "All users of Open-Meteo data must provide a clear attribution to CAMS ENSEMBLE data provider as well as a reference to Open-Meteo." The Licence to use Copernicus Products (https://object-store.os-api.cci2.ecmwf.int/cci2-prod-catalogue/licences/licence-to-use-copernicus-products/licence-to-use-copernicus-products_b4b9451f54cffa16ecef5c912c9cebd6979925a956e3fa677976e0cf198c2c18.pdf), clauses 5.1.1-5.1.3: notice "Generated using Copernicus Atmosphere Monitoring Service information [Year]", or for adapted products "Contains modified Copernicus Atmosphere Monitoring Service information [Year]", and a statement that "neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains". Casa's `/api/air` sends `credit` and that full `notice` with the current year. | 2026-11-09 |

## Quotes

The built-in quotes the typewriter uses until you add your own (`src/vault/quotes.js`). Every author and translator died more than 120 years ago (the latest, G. F. Townsend, in 1900) and every text, translations included, was published by 1891: public domain worldwide. Each wording was checked against the Project Gutenberg text linked (2026-11-09). Two are lightly modernised: Franklin's "One to-day is worth two to-morrows" and Addison's "Chearfulness ... Day-light in the Mind"; the others are verbatim (a sentence may be shortened at a clause break).

| Quote | Author | Source | Status | Checked |
|---|---|---|---|---|
| Slow but steady wins the race. | Aesop | The Hare and the Tortoise, tr. G. F. Townsend (1867), https://www.gutenberg.org/ebooks/21 | Public domain | 2026-11-09 |
| Lost time is never found again. | Benjamin Franklin | The Way to Wealth (1758), https://www.gutenberg.org/ebooks/43855 | Public domain | 2026-11-09 |
| One today is worth two tomorrows. | Benjamin Franklin | The Way to Wealth (1758), https://www.gutenberg.org/ebooks/43855 | Public domain | 2026-11-09 |
| Little strokes fell great oaks. | Benjamin Franklin | The Way to Wealth (1758), https://www.gutenberg.org/ebooks/43855 | Public domain | 2026-11-09 |
| Diligence is the mother of good luck. | Benjamin Franklin | The Way to Wealth (1758), https://www.gutenberg.org/ebooks/43855 | Public domain | 2026-11-09 |
| Dost thou love life? Then do not squander time, for that is the stuff life is made of. | Benjamin Franklin | The Way to Wealth (1758), https://www.gutenberg.org/ebooks/43855 | Public domain | 2026-11-09 |
| The readiness is all. | William Shakespeare | Hamlet, act 5 scene 2, https://www.gutenberg.org/ebooks/100 | Public domain | 2026-11-09 |
| Our doubts are traitors, and make us lose the good we oft might win by fearing to attempt. | William Shakespeare | Measure for Measure, act 1 scene 4, https://www.gutenberg.org/ebooks/100 | Public domain | 2026-11-09 |
| Nothing will come of nothing. | William Shakespeare | King Lear, act 1 scene 1, https://www.gutenberg.org/ebooks/100 | Public domain | 2026-11-09 |
| Simplicity, simplicity, simplicity! | Henry David Thoreau | Walden (1854), chapter 2, https://www.gutenberg.org/ebooks/205 | Public domain | 2026-11-09 |
| Our life is frittered away by detail. Simplify, simplify. | Henry David Thoreau | Walden (1854), chapter 2, https://www.gutenberg.org/ebooks/205 | Public domain | 2026-11-09 |
| Nothing great was ever achieved without enthusiasm. | Ralph Waldo Emerson | Circles, Essays: First Series (1841), https://www.gutenberg.org/ebooks/2944 | Public domain | 2026-11-09 |
| Write it on your heart that every day is the best day in the year. | Ralph Waldo Emerson | Works and Days, Society and Solitude (1870), https://www.gutenberg.org/ebooks/69258 | Public domain | 2026-11-09 |
| Adopt the pace of Nature. Her secret is patience. | Ralph Waldo Emerson | Education, Lectures and Biographical Sketches (1883), https://www.gutenberg.org/ebooks/75942 | Public domain | 2026-11-09 |
| The journey of a thousand li commenced with a single step. | Laozi | Tao Te Ching ch. 64, tr. James Legge (1891), https://www.gutenberg.org/ebooks/216 | Public domain | 2026-11-09 |
| No longer talk at all about the kind of man that a good man ought to be, but be such. | Marcus Aurelius | Meditations X.16, tr. George Long (1862), https://www.gutenberg.org/ebooks/15877 | Public domain | 2026-11-09 |
| Very little indeed is necessary for living a happy life. | Marcus Aurelius | Meditations VII.67, tr. George Long (1862), https://www.gutenberg.org/ebooks/15877 | Public domain | 2026-11-09 |
| Cheerfulness keeps up a kind of daylight in the mind. | Joseph Addison | The Spectator No. 381 (1712), https://www.gutenberg.org/ebooks/12030 | Public domain | 2026-11-09 |
| Hope is the thing with feathers that perches in the soul. | Emily Dickinson | Poems, Second Series (1891), poem "Hope", https://www.gutenberg.org/ebooks/12242 | Public domain | 2026-11-09 |
| I'm not afraid of storms, for I'm learning how to sail my ship. | Louisa May Alcott | Little Women, part 2 (1869), https://www.gutenberg.org/ebooks/514 | Public domain | 2026-11-09 |

## Mailbox photo in the "Add your own object" card

- Photo: [Mailboxnc.jpg](https://commons.wikimedia.org/wiki/File:Mailboxnc.jpg) by SimonMorrison, licence [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/). Cropped and scaled down to 364x252. Credited in the card itself. Checked 2026-11-14.
- The pixel mailbox next to it is drawn by Casa (same as on casa.adrianofontanari.com).
