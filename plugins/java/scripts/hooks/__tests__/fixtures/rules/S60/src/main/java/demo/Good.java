package demo;

import io.swagger.v3.oas.annotations.ExternalDocumentation;
import io.swagger.v3.oas.annotations.media.Schema;

@ExternalDocumentation(url = "https://docs.acme.com/payments")
class Good {

    private static final String XSD = "http://www.w3.org/2001/XMLSchema";

    private static final String SCHEMA = "https://json-schema.org/draft/2020-12/schema";

    @Schema(example = "https://shop.acme.com/orders/42")
    String link;

    // Points at https://developer.paypal.com for the contract.
    String scheme = "https";

}
