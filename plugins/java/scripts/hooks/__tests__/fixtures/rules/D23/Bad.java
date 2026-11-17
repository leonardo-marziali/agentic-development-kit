package demo;

import jakarta.persistence.Entity;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.relational.core.mapping.Table;

class Bad {

    @Entity
    static class OrderEntity {

        private Long id;

        private String addressStreet; // expect: D23

        private String addressCity;

        private String addressZipCode;

    }

    record CustomerReadDto(String name, String billingStreet, String billingCity, String billingZip) { // expect: D23
    }

    // A JDBC row groups with @Embedded too: the values stay columns, so no join.
    @Table("orders")
    static class OrderRow {

        private String addressStreet; // expect: D23

        private String addressCity;

        private String addressZip;

    }

    @Document
    static class InvoiceDocument {

        private String totalNet; // expect: D23

        private String totalTax;

        private String totalGross;

    }

}
