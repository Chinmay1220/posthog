// Screenshots of the PostHog AI quill comparison story, plus (for the "after" pass) a clipboard
// read-back of each answer copy button. Usage: node shot.mjs <after|before>
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'

const label = process.argv[2]
const url =
    'http://localhost:6006/iframe.html?viewMode=story&id=scenes-app-posthog-ai-quill-comparison--side-by-side&globals=theme:'
const origin = 'http://localhost:6006'
const browser = await chromium.launch()

async function open(theme, scale) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: scale })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    const page = await context.newPage()
    await page.goto(url + theme, { timeout: 900000, waitUntil: 'networkidle' })
    await page.waitForTimeout(8000)
    return { context, page }
}

for (const theme of ['light', 'dark']) {
    const { context, page } = await open(theme, 2)
    const names = await page
        .locator('[aria-label], [title]')
        .evaluateAll((els) =>
            els.map((e) => e.getAttribute('aria-label') || e.getAttribute('title')).filter((n) => /copy|markdown/i.test(n))
        )
    console.log(label, theme, 'copy controls:', JSON.stringify(names))
    await page.screenshot({ path: `/tmp/out/${label}-${theme}.png`, fullPage: true })
    await context.close()
}

if (label === 'after') {
    const { context, page } = await open('light', 1)
    const targets = [
        ['lemon plain', page.getByRole('button', { name: 'Copy answer', exact: true }).first()],
        ['lemon markdown', page.getByRole('button', { name: 'Markdown', exact: true }).first()],
        ['quill plain', page.locator('[aria-label="Copy answer"]').last()],
        ['quill markdown', page.locator('[aria-label="Copy answer as Markdown"]').last()],
    ]
    const results = []
    for (const [name, locator] of targets) {
        try {
            await page.evaluate(() => navigator.clipboard.writeText('<empty>'))
            await locator.scrollIntoViewIfNeeded({ timeout: 10000 })
            await locator.click({ timeout: 10000 })
            await page.waitForTimeout(700)
            const text = await page.evaluate(() => navigator.clipboard.readText())
            results.push(`=== ${name} (${text.length} chars)\n${text}`)
        } catch (e) {
            results.push(`=== ${name} FAILED: ${e.message.split('\n')[0]}`)
        }
    }
    console.log(results.join('\n\n'))
    writeFileSync('/tmp/out/clipboard.txt', results.join('\n\n') + '\n')
    await context.close()
}

await browser.close()
