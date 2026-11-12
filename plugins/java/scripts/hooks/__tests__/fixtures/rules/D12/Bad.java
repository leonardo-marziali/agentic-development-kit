package demo;

import jakarta.persistence.Entity;
import org.springframework.data.mongodb.core.mapping.Document;

class Bad {

    @Entity
    static class OrderEntity {

        private Long id;

        private String addressStreet; // expect: D12

        private String addressCity;

        private String addressZipCode;

    }

    record CustomerReadDto(String name, String billingStreet, String billingCity, String billingZip) { // expect: D12
    }

    @Document
    static class InvoiceDocument {

        private String totalNet; // expect: D12

        private String totalTax;

        private String totalGross;

    }

}
