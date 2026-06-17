"""OpenAI-compatible client construction for the clustering labeling agents.

When the ai-gateway is configured (``LLMA_GATEWAY_URL`` + ``LLMA_GATEWAY_API_KEY``),
the labeling agents route through the gateway's slugless OpenAI endpoint with a
``phs_`` project secret bearer; otherwise they go direct to OpenAI with
``OPENAI_API_KEY``, exactly as before. This module holds that rule once so the
trace and evaluation labeling agents share it and neither bypasses the gateway.
"""

import os
from urllib.parse import urlparse

from django.conf import settings

import httpx
from langchain_openai import ChatOpenAI

from posthog.cloud_utils import is_cloud


def build_openai_chat_client(model: str, timeout: float) -> ChatOpenAI:
    """Return a ChatOpenAI client for cluster labeling.

    Enforces the AI-feature guardrail (Cloud or local DEBUG only). Routes through the
    ai-gateway when both gateway settings are set: the gateway derives the team from
    the ``phs_`` bearer, so no per-team header is needed. Otherwise goes direct to
    OpenAI with ``OPENAI_API_KEY``.
    """
    if not settings.DEBUG and not is_cloud():
        raise Exception("AI features are only available in PostHog Cloud")

    url, api_key = settings.LLMA_GATEWAY_URL, settings.LLMA_GATEWAY_API_KEY
    if url or api_key:
        # The two settings only make sense together; reject a half-applied config
        # rather than silently falling back to direct OpenAI.
        if not (url and api_key):
            raise Exception("LLMA_GATEWAY_URL and LLMA_GATEWAY_API_KEY must be set together")
        # The OpenAI SDK posts to base_url + "/chat/completions", so the URL must
        # already carry the OpenAI base path; a missing /v1 would 404 on every call.
        if not urlparse(url).path.rstrip("/").endswith("/v1"):
            raise Exception("LLMA_GATEWAY_URL must include the OpenAI base path, e.g. https://<host>/v1")
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=url,
            timeout=timeout,
            max_retries=2,
            # Keep the in-cluster gateway call off the egress proxy and ambient
            # .netrc/SSL env, matching posthog/llm/gateway_client.py.
            http_client=httpx.Client(trust_env=False),
            http_async_client=httpx.AsyncClient(trust_env=False),
        )

    direct_key = os.environ.get("OPENAI_API_KEY")
    if not direct_key:
        raise Exception("OPENAI_API_KEY is not configured")
    return ChatOpenAI(
        model=model,
        api_key=direct_key,
        timeout=timeout,
        max_retries=2,
    )
