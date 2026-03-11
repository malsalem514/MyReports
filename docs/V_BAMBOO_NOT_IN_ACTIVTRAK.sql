-- ============================================================================
-- V_BAMBOO_NOT_IN_ACTIVTRAK
-- Subset of V_USER_MAPPINGS with no ActivTrak footprint.
-- ============================================================================

CREATE OR REPLACE VIEW V_BAMBOO_NOT_IN_ACTIVTRAK AS
SELECT *
FROM V_USER_MAPPINGS
WHERE HAS_ACTIVTRAK_USER = 0;
