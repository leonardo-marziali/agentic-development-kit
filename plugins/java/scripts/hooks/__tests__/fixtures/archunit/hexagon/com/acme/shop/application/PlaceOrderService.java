package com.acme.shop.application;

import com.acme.shop.persistence.OrderRow;

class PlaceOrderService implements PlaceOrder {

    OrderRow row;

    @Override
    public void execute() {
        // Reaches into an adapter instead of a driven port.
    }

}
