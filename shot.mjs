// Screenshots of each PostHog AI answer footer, plus a clipboard read-back of every copy button.
// Runs against a static Storybook build served on :6006. Usage: node shot.mjs
import { appendFileSync, writeFileSync } from 'fs'
import { chromium } from 'playwright'

const OUT = '/tmp/out'
const ORIGIN = 'http://localhost:6006'
const COMPARISON = 'scenes-app-posthog-ai-quill-comparison--side-by-side'
const THREAD_VIEW = 'products-posthog-ai-threadview--message-footers'

const t0 = Date.now()
const log = (...args) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...args)
// A page that never settles must not eat the job's time budget.
setTimeout(() => {
    log('WATCHDOG: giving up')
    process.exit(3)
}, 25 * 60 * 1000).unref()
const within = (promise, ms, what) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))])

const browser = await chromium.launch()

async function open(storyId, theme, readySelector, readyCount) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
    const page = await context.newPage()
    const tag = `[${storyId} ${theme}]`
    page.on('console', (m) => appendFileSync(`${OUT}/browser.log`, `${tag} ${m.type()}: ${m.text()}\n`))
    page.on('pageerror', (e) => appendFileSync(`${OUT}/browser.log`, `${tag} pageerror: ${e.message}\n`))
    log('open', storyId, theme)
    await page.goto(`${ORIGIN}/iframe.html?viewMode=story&id=${storyId}&globals=theme:${theme}`, {
        waitUntil: 'load',
        timeout: 120000,
    })
    try {
        await page.waitForFunction(
            ([selector, count]) => document.querySelectorAll(selector).length >= count,
            [readySelector, readyCount],
            { timeout: 180000 }
        )
    } catch (e) {
        log('not ready:', e.message.split('\n')[0])
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => log('network never went idle'))
    await within(
        page.evaluate(() => document.fonts.ready.then(() => true)),
        30000,
        'fonts'
    ).catch((e) => log(e.message))
    await page.waitForTimeout(3000)
    const names = await within(
        page
            .locator('[aria-label]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((n) => /copy/i.test(n))),
        30000,
        'list copy controls'
    ).catch((e) => [e.message])
    log(tag, 'copy controls:', JSON.stringify(names))
    return { context, page }
}

function column(page, title) {
    return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

// Each footer: where it is, its two copy buttons, and the box to crop the screenshot to.
function comparisonFooters(page) {
    const legacyLemon = column(page, 'PostHog AI now')
    const legacyQuill = column(page, 'PostHog AI quill')
    const sandboxQuill = column(page, 'PostHog AI 2.0 quill')
    return [
        {
            name: 'legacy-lemon',
            box: legacyLemon,
            plain: legacyLemon.locator('[aria-label="Copy answer"]').last(),
            markdown: legacyLemon.locator('[aria-label="Copy answer as Markdown"]').last(),
        },
        {
            name: 'legacy-quill',
            box: legacyQuill,
            plain: legacyQuill.locator('[aria-label="Copy answer"]').last(),
            markdown: legacyQuill.locator('[aria-label="Copy answer as Markdown"]').last(),
        },
        {
            name: 'sandbox-quill',
            box: sandboxQuill,
            plain: sandboxQuill.locator('[data-attr="posthog-ai-turn-copy"]').last(),
            markdown: sandboxQuill.locator('[data-attr="posthog-ai-turn-copy-markdown"]').last(),
            hoverToReveal: true,
        },
    ]
}

function threadViewFooters(page) {
    const box = page.locator('#storybook-root div.w-180').or(page.locator('#storybook-root > *')).first()
    return [
        {
            name: 'sandbox-lemon',
            box,
            plain: page.locator('[data-attr="posthog-ai-turn-copy"]').first(),
            markdown: page.locator('[data-attr="posthog-ai-turn-copy-markdown"]').first(),
        },
    ]
}

async function bringIntoView(page, footer) {
    await within(
        footer.markdown.evaluate((el) => el.scrollIntoView({ block: 'center' })),
        15000,
        'scroll'
    )
    if (footer.hoverToReveal) {
        // The quill sandbox footer has no height until its turn is hovered: point just above it, at the answer.
        const b = await within(
            footer.markdown.evaluate((el) => {
                const r = (el.closest('.QuillFooterReveal') ?? el).getBoundingClientRect()
                return { x: r.x, y: r.y }
            }),
            15000,
            'footer position'
        )
        await page.mouse.move(b.x + 60, b.y - 12)
        await page.waitForTimeout(600)
    }
}

async function crop(page, footer, file) {
    const btn = await footer.markdown.boundingBox()
    const box = await footer.box.boundingBox()
    if (!btn || !box) {
        throw new Error('no bounding box')
    }
    const y = Math.max(0, btn.y - 200)
    await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 8), y, width: box.width + 16, height: btn.y - y + 70 } })
}

async function shoot(theme) {
    for (const [storyId, footersOf, readySelector, readyCount] of [
        [COMPARISON, comparisonFooters, '[aria-label="Copy answer as Markdown"]', 3],
        [THREAD_VIEW, threadViewFooters, '[data-attr="posthog-ai-turn-copy-markdown"]', 1],
    ]) {
        const { context, page } = await open(storyId, theme, readySelector, readyCount)
        await page.screenshot({ path: `${OUT}/${storyId}-${theme}.png`, fullPage: true }).catch((e) => log(e.message))
        for (const footer of footersOf(page)) {
            try {
                await bringIntoView(page, footer)
                await footer.markdown.hover({ timeout: 15000 })
                await page.waitForTimeout(1500)
                await crop(page, footer, `${OUT}/footer-${footer.name}-${theme}.png`)
                log('cropped', footer.name, theme)
            } catch (e) {
                log('crop FAILED', footer.name, theme, e.message.split('\n')[0])
            }
        }
        await context.close()
    }
}

async function clipboardCheck() {
    const results = []
    for (const [storyId, footersOf, readySelector, readyCount] of [
        [COMPARISON, comparisonFooters, '[aria-label="Copy answer as Markdown"]', 3],
        [THREAD_VIEW, threadViewFooters, '[data-attr="posthog-ai-turn-copy-markdown"]', 1],
    ]) {
        const { context, page } = await open(storyId, 'light', readySelector, readyCount)
        for (const footer of footersOf(page)) {
            for (const kind of ['plain', 'markdown']) {
                const name = `${footer.name} ${kind}`
                try {
                    await bringIntoView(page, footer)
                    await within(
                        page.evaluate(() => navigator.clipboard.writeText('<empty>')),
                        10000,
                        'clear clipboard'
                    )
                    await footer[kind].click({ timeout: 15000 })
                    await page.waitForTimeout(800)
                    const text = await within(
                        page.evaluate(() => navigator.clipboard.readText()),
                        10000,
                        'read clipboard'
                    )
                    results.push(`=== ${name} (${text.length} chars)\n${text}`)
                    log('copied', name, text.length, 'chars')
                } catch (e) {
                    results.push(`=== ${name} FAILED: ${e.message.split('\n')[0]}`)
                    log('copy FAILED', name, e.message.split('\n')[0])
                }
            }
        }
        await context.close()
    }
    writeFileSync(`${OUT}/clipboard.txt`, results.join('\n\n') + '\n')
}

await shoot('light')
await shoot('dark')
await clipboardCheck()
await browser.close()
log('done')
