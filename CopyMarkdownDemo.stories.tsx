import { Meta, StoryObj } from '@storybook/react'

import { ThreadSkinOverrideContext } from 'products/posthog_ai/frontend/api/logics'

import { ThreadWithSQLQueryOverflow } from './MaxTools.stories'
import { sharedMeta } from './maxStoriesShared'

// Demo only, never committed: the LangGraph thread with a finished Markdown answer, in the quill skin,
// wrapped the same way as the quill columns of PostHogAiQuillComparison.stories.tsx.
const meta: Meta = {
    title: 'Demo/Copy markdown',
    ...sharedMeta,
}
export default meta

export const Quill: StoryObj<{}> = {
    ...ThreadWithSQLQueryOverflow,
    decorators: [
        (Story) => (
            <ThreadSkinOverrideContext.Provider value="quill">
                <Story />
            </ThreadSkinOverrideContext.Provider>
        ),
    ],
}
