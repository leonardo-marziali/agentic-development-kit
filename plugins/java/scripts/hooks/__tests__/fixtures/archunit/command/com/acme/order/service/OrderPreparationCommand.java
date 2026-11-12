package com.acme.order.service;

public record OrderPreparationCommand(String orderId, String warehouseId) {

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {

        private String orderId;

        private String warehouseId;

        public Builder orderId(String orderId) {
            this.orderId = orderId;
            return this;
        }

        public Builder warehouseId(String warehouseId) {
            this.warehouseId = warehouseId;
            return this;
        }

        public OrderPreparationCommand build() {
            return new OrderPreparationCommand(orderId, warehouseId);
        }

    }

}
