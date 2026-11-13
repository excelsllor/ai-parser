ALTER TABLE two_factor_codes
    DROP CONSTRAINT IF EXISTS two_factor_codes_purpose_check;
ALTER TABLE two_factor_codes
    ADD CONSTRAINT two_factor_codes_purpose_check
    CHECK (purpose IN ('login', 'enable', 'disable'));
