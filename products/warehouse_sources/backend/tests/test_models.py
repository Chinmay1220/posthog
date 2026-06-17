from datetime import date, datetime

import pytest

from django.db.models import Model

from products.data_warehouse.backend.types import IncrementalFieldType
from products.warehouse_sources.backend.models.credential import DataWarehouseCredential
from products.warehouse_sources.backend.models.external_data_job import ExternalDataJob
from products.warehouse_sources.backend.models.external_data_schema import (
    ExternalDataSchema,
    apply_incremental_lookback,
)
from products.warehouse_sources.backend.models.external_data_source import ExternalDataSource
from products.warehouse_sources.backend.models.table import DataWarehouseTable
from products.warehouse_sources.backend.models.util import CLICKHOUSE_HOGQL_MAPPING, clean_type


@pytest.mark.parametrize(
    "model,expected_db_table",
    [
        (DataWarehouseCredential, "posthog_datawarehousecredential"),
        (DataWarehouseTable, "posthog_datawarehousetable"),
        (ExternalDataJob, "posthog_externaldatajob"),
        (ExternalDataSchema, "posthog_externaldataschema"),
        (ExternalDataSource, "posthog_externaldatasource"),
    ],
)
def test_db_table_preserved_across_split(model: type[Model], expected_db_table: str) -> None:
    """The split moved these models to a new Django app via SeparateDatabaseAndState;
    the `posthog_*` table names must remain unchanged or prod reads break silently."""
    assert model._meta.db_table == expected_db_table


@pytest.mark.parametrize(
    "s3_folder_name,sync_type_config,expected",
    [
        ("legacy_users", {"dwh_storage_key": "ignored"}, "legacy_users"),
        (None, {"dwh_storage_key": "legacy_users"}, "legacy_users"),
        ("", {"dwh_storage_key": "legacy_users"}, "legacy_users"),
        (None, {"dwh_storage_key": ""}, None),
        (None, {"dwh_storage_key": 123}, None),
        (None, {}, None),
        (None, None, None),
    ],
)
def test_resolved_s3_folder_name(
    s3_folder_name: str | None, sync_type_config: dict | None, expected: str | None
) -> None:
    """Column wins; rows written by pre-column workers fall back to the JSON key; junk yields None
    so callers fall back to the schema name."""
    schema = ExternalDataSchema(s3_folder_name=s3_folder_name, sync_type_config=sync_type_config)
    assert schema.resolved_s3_folder_name == expected


@pytest.mark.parametrize(
    "clickhouse_type,expected",
    [
        ("String", "String"),
        ("Nullable(String)", "String"),
        ("LowCardinality(String)", "String"),
        ("LowCardinality(Nullable(String))", "String"),
    ],
)
def test_clean_type_unwraps_low_cardinality(clickhouse_type: str, expected: str) -> None:
    """`ai_events` exposes LowCardinality columns (event, model, provider, ...). clean_type must
    unwrap LowCardinality so the ClickHouse->HogQL mapping lookup resolves instead of KeyError-ing."""
    cleaned = clean_type(clickhouse_type)
    assert cleaned == expected
    assert cleaned in CLICKHOUSE_HOGQL_MAPPING


@pytest.mark.parametrize(
    "value,field_type,lookback_seconds,expected",
    [
        (datetime(2026, 6, 14, 15, 33, 31), IncrementalFieldType.Timestamp, 3600, datetime(2026, 6, 14, 14, 33, 31)),
        (datetime(2026, 6, 14, 15, 33, 31), IncrementalFieldType.DateTime, 86400, datetime(2026, 6, 13, 15, 33, 31)),
        (date(2026, 6, 14), IncrementalFieldType.Date, 86400, date(2026, 6, 13)),
        # Date arithmetic ignores the sub-day part of the delta, so a <1-day lookback is a no-op for date fields.
        (date(2026, 6, 14), IncrementalFieldType.Date, 3600, date(2026, 6, 14)),
        (datetime(2026, 6, 14, 15, 33, 31), IncrementalFieldType.Timestamp, None, datetime(2026, 6, 14, 15, 33, 31)),
        (datetime(2026, 6, 14, 15, 33, 31), IncrementalFieldType.Timestamp, 0, datetime(2026, 6, 14, 15, 33, 31)),
        (datetime(2026, 6, 14, 15, 33, 31), IncrementalFieldType.Timestamp, -5, datetime(2026, 6, 14, 15, 33, 31)),
        (100, IncrementalFieldType.Integer, 3600, 100),
        (100, IncrementalFieldType.Numeric, 3600, 100),
        ("abc123", IncrementalFieldType.ObjectID, 3600, "abc123"),
        (None, IncrementalFieldType.Timestamp, 3600, None),
        (datetime(2026, 6, 14, 15, 33, 31), None, 3600, datetime(2026, 6, 14, 15, 33, 31)),
    ],
)
def test_apply_incremental_lookback(value, field_type, lookback_seconds, expected) -> None:
    assert apply_incremental_lookback(value, field_type, lookback_seconds) == expected
