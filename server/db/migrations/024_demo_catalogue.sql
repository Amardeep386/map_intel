-- MAP Intel · demo catalogue (28 Sep 2026): the fields of the brands' product sheets and merchant lists.
--   * product: model family, configuration, colour and the brand's internal id (columns F–I of the
--     "<Brand> Product Summary" sheets).
--   * account_source.profile: how the brand's merchant list describes a subscribed source (channel
--     type, seller model, authorisation, priority, check frequency, collection method, notes and
--     the product categories it covers). Descriptive only: collection is driven by schedules.

SELECT set_config('app.role', 'system', true);

ALTER TABLE product ADD COLUMN model_family text;
ALTER TABLE product ADD COLUMN configuration text;
ALTER TABLE product ADD COLUMN colour text;
ALTER TABLE product ADD COLUMN internal_id text;

ALTER TABLE account_source ADD COLUMN profile jsonb NOT NULL DEFAULT '{}'::jsonb;
