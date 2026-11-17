package com.acme.project.application;

import org.springframework.stereotype.Service;

@Service
class CloseProjectService {

    public void execute() {
        // Closes the project.
    }

    public void notifyOwners() {
        // A second action: it belongs in its own service.
    }

}
