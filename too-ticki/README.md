# Claude-mod: Too-ticki 🐕

En strihåret dachs i piksler som bor rett over prompten i **Claude desktop-appen** (Code-fanen).

Bygget på [my-the-cat](https://github.com/ehJimmy/my-the-cat) av ehJimmy (MIT). Uoffisiell mod, ikke laget av Anthropic.

- **Mens Claude jobber** rusler hun fram og tilbake, og innimellom graver hun et hull, snuser i bakken eller spurter etter ballen sin.
- **Hun reagerer på verktøyene Claude bruker:** graver når Claude søker (`rg`, `grep`, `find`, websøk), snuser når Claude leser (Read, `cat`, WebFetch), og bjeffer når et verktøykall feiler.
- **Hver agent som kjører er en valp.** Starter Claude en subagent, dukker det opp en valp som tusler rundt for seg selv til agenten er ferdig. Hver valp får sin egen pelsfarge (viltfarget, rød, black and tan, sjokolade, krem, pepper og salt). Hold musepekeren over en valp for å se hvilken agent den er.
- **Når en oppgave er ferdig** setter hun seg på bakbeina ved gullbeinet sitt mens konfettien daler, rusler hjem til plassen sin og setter seg.
- **Mens du skriver** svever hun over prompten med labbene trukket opp og ørene som vinger.
- **Når det er stille** legger hun seg og sover.
- **Til høyre** viser hun forbruket ditt: **Luktespor** (kontekstvinduet), **Luftetur** (5-timersgrensen) og **Uka**. Stolpene blir oransje ved 75 % og røde ved 90 %.

## Installere

Be Claude i en Code-chat i desktop-appen:

> Please install the Claude Code plugin too-ticki: add the plugin marketplace ehJimmy/my-the-cat, then install too-ticki@my-the-cat.

## Hvordan den er bygget

| Fil | Hva |
| --- | --- |
| `hooks/register.tsx` | Selve modden: hva hun gjør når, valpetellingen, verktøyreaksjonene |
| `hooks/scene.ts` | Tegner hver scene som én selvanimerende SVG (SMIL) |
| `hooks/usage.ts` | Forbrukspanelet |
| `hooks/vectors.ts`, `actions.ts`, `pups.ts`, `sprites.ts` | Pikseltegningene, generert |
| `build/gen.py` | Tegner Too-ticki og valpene. Endre tegningen her og kjør `python3 build/gen.py` |
| `tests/too-ticki.test.tsx` | Tester: `claude plugin test .` |

En ny tegning får bildet til å blinke, så modden tegner bare på nytt når noe faktisk endrer seg: Claude starter eller stopper, du begynner eller slutter å skrive, hun reagerer på et verktøy (høyst hvert niende sekund), eller en valp kommer eller går. Det tegnes høyst seks valper om gangen.

Terminalversjonen (CLI) viser Too-ticki som bilde og valpene som et tall. Den er, som i originalen, ikke testet.

## Privat

Modden kjører bare på din egen maskin og sender ingenting noe sted.

## Lisens

MIT, se [LICENSE](../LICENSE). Originalen er © 2026 ehJimmy.
