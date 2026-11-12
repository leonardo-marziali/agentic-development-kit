package demo;

import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import org.springframework.data.relational.core.mapping.Table;

class Good {

    @Entity
    static class OrderEntity {

        private static final String ADDRESS_A = "a", ADDRESS_B = "b", ADDRESS_C = "c";

        @Embedded
        private AddressEmbeddable address;

        private boolean isActive;

        private boolean isDeleted;

        private boolean isLocked;

        private String createdAt;

        private String createdBy;

    }

    static class AddressEmbeddable {

        private String street;

        private String city;

        private String zip;

    }

    // Raw SQL rows stay flat: grouping them would add joins.
    @Table("orders")
    static class OrderRow {

        private String addressStreet;

        private String addressCity;

        private String addressZip;

    }

    static class Helper {

        private String addressStreet;

        private String addressCity;

        private String addressZip;

    }

}
