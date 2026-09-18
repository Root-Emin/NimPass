-- Pass is the sellable product. The customer's owned instance is a purchased
-- pass: same offer, independent session progress. Historical migrations keep
-- the old names; this one brings the live schema in line with the product.

-- Owned instances first, so the catalog can take the `passes` name.
ALTER TABLE passes RENAME TO purchased_passes;

ALTER TABLE packages RENAME TO passes;

ALTER TABLE purchases RENAME COLUMN package_id TO pass_id;
ALTER TABLE purchases RENAME COLUMN package_title_snapshot TO pass_title_snapshot;

ALTER TABLE purchased_passes RENAME COLUMN package_id TO pass_id;
ALTER TABLE purchased_passes RENAME COLUMN package_title_snapshot TO pass_title_snapshot;

ALTER TABLE passes RENAME CONSTRAINT packages_service_provider_fk TO passes_service_provider_fk;
ALTER TABLE passes RENAME CONSTRAINT packages_title_nonempty TO passes_title_nonempty;
ALTER TABLE passes RENAME CONSTRAINT packages_sessions_positive TO passes_sessions_positive;
ALTER TABLE passes RENAME CONSTRAINT packages_price_positive TO passes_price_positive;
ALTER TABLE passes RENAME CONSTRAINT packages_currency_nim TO passes_currency_nim;
ALTER TABLE passes RENAME CONSTRAINT packages_status_valid TO passes_status_valid;
ALTER TABLE passes RENAME CONSTRAINT packages_provider_service_id_unique TO passes_provider_service_id_unique;
ALTER TABLE passes RENAME CONSTRAINT packages_accent_valid TO passes_accent_valid;

ALTER INDEX packages_public_idx RENAME TO passes_public_idx;
ALTER INDEX packages_service_idx RENAME TO passes_service_idx;

ALTER TABLE purchases RENAME CONSTRAINT purchases_package_relation_fk TO purchases_pass_relation_fk;
ALTER INDEX purchases_package_idx RENAME TO purchases_pass_idx;

ALTER TABLE purchased_passes RENAME CONSTRAINT passes_package_relation_fk TO purchased_passes_pass_relation_fk;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_verified_purchase_fk TO purchased_passes_verified_purchase_fk;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_owner_shape TO purchased_passes_owner_shape;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_price_positive TO purchased_passes_price_positive;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_currency_nim TO purchased_passes_currency_nim;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_original_positive TO purchased_passes_original_positive;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_used_nonnegative TO purchased_passes_used_nonnegative;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_remaining_nonnegative TO purchased_passes_remaining_nonnegative;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_balance_consistent TO purchased_passes_balance_consistent;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_status_valid TO purchased_passes_status_valid;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_completed_balance TO purchased_passes_completed_balance;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_active_balance TO purchased_passes_active_balance;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_expired_has_date TO purchased_passes_expired_has_date;
ALTER TABLE purchased_passes RENAME CONSTRAINT passes_provider_owner_unique TO purchased_passes_provider_owner_unique;

ALTER INDEX passes_owner_status_idx RENAME TO purchased_passes_owner_status_idx;
ALTER INDEX passes_provider_status_idx RENAME TO purchased_passes_provider_status_idx;
ALTER INDEX passes_customer_page_idx RENAME TO purchased_passes_customer_page_idx;

UPDATE compensation_cases
   SET reason = 'PASS_EXPIRED_BEFORE_ACTIVATION'
 WHERE reason = 'PACKAGE_EXPIRED_BEFORE_ACTIVATION';

ALTER TABLE compensation_cases DROP CONSTRAINT compensation_cases_reason_valid;
ALTER TABLE compensation_cases ADD CONSTRAINT compensation_cases_reason_valid
    CHECK (reason = 'PASS_EXPIRED_BEFORE_ACTIVATION');
