package demo;

import java.net.URI;

class Bad {

    private static final String PAYPAL = "https://api-m.paypal.com/v2"; // expect: S60

    URI local() {
        return URI.create("http://localhost:8080/payments"); // expect: S60
    }

    String built(String host) {
        return "https://" + host + "/v2"; // expect: S60
    }

}
